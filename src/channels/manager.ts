/**
 * Channel Manager — orchestrates channel plugin lifecycles and message routing.
 *
 * For each configured channel account:
 * 1. Starts the gateway adapter (receive messages)
 * 2. Routes incoming messages to per-conversation Agents
 * 3. Collects Agent responses via MessageAggregator
 * 4. Sends responses back via the outbound adapter
 *
 * Channel is just a messenger — it doesn't manage context or history.
 * That's the Agent's job.
 */

import type { Hub } from "../hub/hub.js";
import type {
  ChannelPlugin,
  ChannelMessage,
  ChannelAccountState,
  DeliveryContext,
} from "./types.js";
import { listChannels } from "./registry.js";
import { loadChannelsConfig } from "./config.js";
import { MessageAggregator, DEFAULT_CHUNKER_CONFIG } from "../hub/message-aggregator.js";
import type { AsyncAgent } from "../agent/async-agent.js";

interface AccountHandle {
  channelId: string;
  accountId: string;
  abortController: AbortController;
  state: ChannelAccountState;
}

export class ChannelManager {
  private readonly hub: Hub;
  /** Running accounts keyed by "channelId:accountId" */
  private readonly accounts = new Map<string, AccountHandle>();
  /** Agents keyed by "channelId:conversationId" for per-conversation isolation */
  private readonly conversationAgents = new Map<string, AsyncAgent>();

  constructor(hub: Hub) {
    this.hub = hub;
  }

  /** Start all configured channel accounts */
  async startAll(): Promise<void> {
    console.log("[Channels] Starting all channels...");
    const config = loadChannelsConfig();
    const plugins = listChannels();

    if (plugins.length === 0) {
      console.log("[Channels] No plugins registered");
      return;
    }

    for (const plugin of plugins) {
      const accountIds = plugin.config.listAccountIds(config);
      if (accountIds.length === 0) {
        console.log(`[Channels] Skipping ${plugin.id} (not configured)`);
        continue;
      }

      for (const accountId of accountIds) {
        const account = plugin.config.resolveAccount(config, accountId);
        if (!account || !plugin.config.isConfigured(account)) {
          console.log(`[Channels] Skipping ${plugin.id}:${accountId} (incomplete config)`);
          continue;
        }
        await this.startAccount(plugin.id, accountId, account);
      }
    }
  }

  /** Start a specific channel account */
  private async startAccount(
    channelId: string,
    accountId: string,
    accountConfig: Record<string, unknown>,
  ): Promise<void> {
    const key = `${channelId}:${accountId}`;
    if (this.accounts.has(key)) {
      console.warn(`[Channels] ${key} is already running`);
      return;
    }

    const plugin = listChannels().find((p) => p.id === channelId);
    if (!plugin) {
      console.error(`[Channels] Plugin "${channelId}" not found`);
      return;
    }

    const abortController = new AbortController();
    const handle: AccountHandle = {
      channelId,
      accountId,
      abortController,
      state: { channelId, accountId, status: "starting" },
    };
    this.accounts.set(key, handle);

    console.log(`[Channels] Starting ${key}`);

    try {
      // Start gateway — this begins receiving messages
      // The promise may resolve immediately (polling started) or stay pending (long-connection)
      const startPromise = plugin.gateway.start(
        accountId,
        accountConfig,
        (message: ChannelMessage) => {
          this.routeIncoming(plugin, accountId, message);
        },
        abortController.signal,
      );

      // Don't await forever — the start() might be long-running (e.g. polling loop)
      // Give it a moment to fail fast if credentials are wrong
      await Promise.race([
        startPromise,
        new Promise<void>((resolve) => setTimeout(resolve, 3000)),
      ]);

      handle.state = { channelId, accountId, status: "running" };
      console.log(`[Channels] ${key} is running`);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      handle.state = { channelId, accountId, status: "error", error: errorMsg };
      console.error(`[Channels] Failed to start ${key}: ${errorMsg}`);
    }
  }

  /** Stop all running channel accounts */
  stopAll(): void {
    console.log("[Channels] Stopping all channels...");
    for (const [key, handle] of this.accounts) {
      handle.abortController.abort();
      handle.state = { ...handle.state, status: "stopped" };
      console.log(`[Channels] Stopped ${key}`);
    }
    this.accounts.clear();
    this.conversationAgents.clear();
  }

  /** Get or create an Agent for a specific conversation */
  private getOrCreateAgent(channelId: string, conversationId: string): AsyncAgent {
    const key = `${channelId}:${conversationId}`;
    const existing = this.conversationAgents.get(key);
    if (existing && !existing.closed) {
      return existing;
    }

    const agent = this.hub.createAgent();
    this.conversationAgents.set(key, agent);
    return agent;
  }

  /**
   * Route an incoming message to the appropriate Agent and wire the response
   * back to the channel via MessageAggregator.
   *
   * This is the core bridge logic — generalized for any channel.
   */
  private routeIncoming(
    plugin: ChannelPlugin,
    accountId: string,
    message: ChannelMessage,
  ): void {
    const { conversationId, senderId, text, messageId } = message;
    console.log(
      `[Channels] Incoming message: channel=${plugin.id} conv=${conversationId} sender=${senderId} text="${text.slice(0, 50)}${text.length > 50 ? "..." : ""}"`,
    );

    // Find or create Agent for this conversation
    const agent = this.getOrCreateAgent(plugin.id, conversationId);
    const isNew = !this.conversationAgents.has(`${plugin.id}:${conversationId}`) ? "new" : "existing";
    console.log(`[Channels] Routing to agent: key=${plugin.id}:${conversationId} agentId=${agent.sessionId} (${isNew})`);

    // Build delivery context for outbound replies
    const deliveryCtx: DeliveryContext = {
      channel: plugin.id,
      accountId,
      conversationId,
      replyToMessageId: messageId,
    };

    // Use channel-specific chunker config or defaults
    const chunkerConfig = plugin.chunkerConfig ?? DEFAULT_CHUNKER_CONFIG;

    // Create a fresh aggregator for this message's response
    const aggregator = new MessageAggregator(
      chunkerConfig,
      async (block) => {
        try {
          console.log(`[Channels] Block ${block.index} ready (${block.text.length} chars${block.isFinal ? ", final" : ""}), sending reply`);
          if (block.index === 0) {
            await plugin.outbound.replyText(deliveryCtx, block.text);
          } else {
            await plugin.outbound.sendText(deliveryCtx, block.text);
          }
          if (block.isFinal) {
            console.log(`[Channels] Response complete: channel=${plugin.id} conv=${conversationId} blocks=${block.index + 1}`);
          }
        } catch (err) {
          console.error(`[Channels] Failed to send reply: ${err}`);
        }
      },
      (_event) => {
        // Pass-through events (tool_execution, compaction, etc.)
        // Could add typing indicators per-channel later
      },
    );

    // Subscribe to agent events BEFORE writing the message
    console.log("[Channels] Agent subscribed, sending message to agent");
    const unsubscribe = agent.subscribe((event) => {
      aggregator.handleEvent(event);

      // Unsubscribe after the response is complete
      if (event.type === "message_end") {
        const maybeMessage = (event as { message?: { role?: string } }).message;
        if (maybeMessage?.role === "assistant") {
          unsubscribe();
        }
      }
    });

    // Send user message to the agent
    agent.write(text);
  }

  /** Get status of all accounts */
  listAccountStates(): ChannelAccountState[] {
    return Array.from(this.accounts.values()).map((h) => ({ ...h.state }));
  }
}
