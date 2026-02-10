/**
 * Telegram service for Gateway.
 *
 * Handles Telegram bot interactions via webhook.
 * - New users: prompts for Hub URL
 * - Bound users: routes messages to their Hub
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import type { OnModuleInit } from "@nestjs/common";
import { Bot, webhookCallback } from "grammy";
import type { Context } from "grammy";
import { EventsGateway } from "../events.gateway.js";
import { TelegramUserStore } from "./telegram-user.store.js";
import type { TelegramUser } from "./types.js";

// Minimal Express types for webhook handling
interface ExpressRequest {
  body: unknown;
  header: (name: string) => string | undefined;
}

interface ExpressResponse {
  status: (code: number) => ExpressResponse;
  json: (data: unknown) => void;
  headersSent: boolean;
}

// Users in the process of binding Hub URL
interface PendingBinding {
  awaitingUrl: boolean;
  telegramUsername?: string | undefined;
  telegramFirstName?: string | undefined;
  telegramLastName?: string | undefined;
}

@Injectable()
export class TelegramService implements OnModuleInit {
  private bot: Bot | null = null;
  private pendingBindings = new Map<string, PendingBinding>();

  private readonly logger = new Logger(TelegramService.name);

  constructor(
    @Inject(EventsGateway) private readonly eventsGateway: EventsGateway,
    @Inject(TelegramUserStore) private readonly userStore: TelegramUserStore,
  ) {}

  async onModuleInit(): Promise<void> {
    console.log("[TelegramService] onModuleInit starting...");
    const token = process.env["TELEGRAM_BOT_TOKEN"];
    if (!token) {
      console.log("[TelegramService] No bot token");
      this.logger.warn("TELEGRAM_BOT_TOKEN not set, Telegram webhook disabled");
      return;
    }

    console.log("[TelegramService] Creating bot...");
    this.bot = new Bot(token);
    this.setupHandlers();
    this.logger.log("Telegram bot initialized");
  }

  /** Get grammY webhook callback for Express/NestJS */
  getWebhookCallback(): ((req: ExpressRequest, res: ExpressResponse) => Promise<void>) | null {
    if (!this.bot) return null;

    const secretToken = process.env["TELEGRAM_WEBHOOK_SECRET_TOKEN"];
    if (secretToken) {
      return webhookCallback(this.bot, "express", { secretToken }) as unknown as (
        req: ExpressRequest,
        res: ExpressResponse
      ) => Promise<void>;
    }
    return webhookCallback(this.bot, "express") as unknown as (
      req: ExpressRequest,
      res: ExpressResponse
    ) => Promise<void>;
  }

  /** Check if Telegram bot is configured */
  isConfigured(): boolean {
    return this.bot !== null;
  }

  /** Send message to a Telegram user by device ID */
  async sendToTelegram(deviceId: string, text: string): Promise<void> {
    if (!this.bot) return;

    const user = await this.userStore.findByDeviceId(deviceId);
    if (!user) {
      this.logger.warn(`Telegram user not found for device: deviceId=${deviceId}`);
      return;
    }

    try {
      await this.bot.api.sendMessage(Number(user.telegramUserId), text);
      this.logger.debug(`Sent message to Telegram: telegramUserId=${user.telegramUserId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to send Telegram message: deviceId=${deviceId}, error=${message}`);
    }
  }

  /** Setup bot message handlers */
  private setupHandlers(): void {
    if (!this.bot) return;

    this.bot.on("message:text", async (ctx) => {
      await this.handleTextMessage(ctx);
    });
  }

  /** Handle incoming text message */
  private async handleTextMessage(ctx: Context): Promise<void> {
    const msg = ctx.message;
    if (!msg || !msg.text) return;

    const telegramUserId = String(msg.from?.id);
    const text = msg.text.trim();

    this.logger.debug(`Received Telegram message: telegramUserId=${telegramUserId}, text=${text.slice(0, 50)}`);

    // Check if user is bound
    const user = await this.userStore.findByTelegramUserId(telegramUserId);

    if (user) {
      // User is bound, route message to Hub
      await this.routeToHub(user, text, ctx);
      return;
    }

    // Check if user is in binding process
    const pending = this.pendingBindings.get(telegramUserId);

    if (pending?.awaitingUrl) {
      // User is providing Hub URL
      await this.handleHubUrlInput(ctx, telegramUserId, text, pending);
      return;
    }

    // New user, start binding process
    await this.startBindingProcess(ctx, telegramUserId);
  }

  /** Start the Hub binding process for a new user */
  private async startBindingProcess(ctx: Context, telegramUserId: string): Promise<void> {
    const msg = ctx.message;

    this.pendingBindings.set(telegramUserId, {
      awaitingUrl: true,
      telegramUsername: msg?.from?.username,
      telegramFirstName: msg?.from?.first_name,
      telegramLastName: msg?.from?.last_name,
    });

    await ctx.reply(
      "👋 Welcome to Multica!\n\n" +
      "Please enter your Hub URL to get started.\n\n" +
      "Example: https://your-hub.example.com"
    );
  }

  /** Handle Hub URL input from user */
  private async handleHubUrlInput(
    ctx: Context,
    telegramUserId: string,
    url: string,
    pending: PendingBinding
  ): Promise<void> {
    // Validate URL format
    if (!this.isValidUrl(url)) {
      await ctx.reply(
        "❌ Invalid URL format.\n\n" +
        "Please enter a valid Hub URL.\n" +
        "Example: https://your-hub.example.com"
      );
      return;
    }

    // Validate Hub connectivity
    const isValid = await this.validateHubUrl(url);
    if (!isValid) {
      await ctx.reply(
        "❌ Cannot connect to this Hub.\n\n" +
        "Please check the URL and make sure your Hub is online.\n" +
        "Then try again with the correct URL."
      );
      return;
    }

    // Create user record
    try {
      const user = await this.userStore.upsert({
        telegramUserId,
        hubUrl: url,
        telegramUsername: pending.telegramUsername,
        telegramFirstName: pending.telegramFirstName,
        telegramLastName: pending.telegramLastName,
      });

      // Register as virtual device
      this.eventsGateway.registerVirtualDevice(user.deviceId, {
        sendCallback: (_event, data) => {
          const payload = data as { text?: string };
          if (payload.text) {
            this.sendToTelegram(user.deviceId, payload.text);
          }
        },
      });

      this.pendingBindings.delete(telegramUserId);

      await ctx.reply(
        "✅ Hub connected successfully!\n\n" +
        `Your Device ID: ${user.deviceId}\n\n` +
        "You can now send messages to interact with your agent."
      );

      this.logger.log(`Telegram user bound to Hub: telegramUserId=${telegramUserId}, hubUrl=${url}, deviceId=${user.deviceId}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to bind Telegram user: telegramUserId=${telegramUserId}, error=${message}`);
      await ctx.reply("❌ An error occurred. Please try again later.");
    }
  }

  /** Validate URL format */
  private isValidUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  }

  /** Validate Hub URL connectivity */
  private async validateHubUrl(url: string): Promise<boolean> {
    try {
      // Try to connect to the Hub's health endpoint
      const response = await fetch(`${url}/`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /** Route message to user's Hub */
  private async routeToHub(user: TelegramUser, text: string, ctx: Context): Promise<void> {
    // Ensure virtual device is registered
    if (!this.eventsGateway.isDeviceRegistered(user.deviceId)) {
      this.eventsGateway.registerVirtualDevice(user.deviceId, {
        sendCallback: (_event, data) => {
          const payload = data as { text?: string };
          if (payload.text) {
            this.sendToTelegram(user.deviceId, payload.text);
          }
        },
      });
    }

    // TODO: Route message to Hub via EventsGateway
    // For now, just acknowledge receipt
    this.logger.log(`Routing message to Hub: deviceId=${user.deviceId}, hubUrl=${user.hubUrl}`);

    // Placeholder: In full implementation, this would send to Hub
    await ctx.reply(`📨 Message received. Routing to your Hub...`);
  }
}
