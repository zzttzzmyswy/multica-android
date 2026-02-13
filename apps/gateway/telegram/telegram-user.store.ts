/**
 * Telegram user store.
 *
 * Uses MySQL when MYSQL_DSN is set (production).
 * Falls back to JSON file persistence when database is unavailable (local development).
 * File stored at ~/.super-multica/gateway/telegram-users.json.
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateEncryptedId, DATA_DIR } from "@multica/utils";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { RowDataPacket } from "mysql2/promise";
import { DatabaseService } from "../database/database.service.js";
import type { TelegramUser, TelegramUserCreate } from "./types.js";

interface TelegramUserRow extends RowDataPacket {
  telegram_user_id: string;
  hub_id: string;
  agent_id: string;
  device_id: string;
  created_at: Date;
  updated_at: Date;
  telegram_username: string | null;
  telegram_first_name: string | null;
  telegram_last_name: string | null;
}

const LOCAL_STORE_DIR = join(DATA_DIR, "gateway");
const LOCAL_STORE_PATH = join(LOCAL_STORE_DIR, "telegram-users.json");

@Injectable()
export class TelegramUserStore {
  private readonly logger = new Logger(TelegramUserStore.name);
  /** Local file-backed store, keyed by telegramUserId */
  private localStore = new Map<string, TelegramUser>();
  private localStoreLoaded = false;

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Find user by Telegram user ID */
  async findByTelegramUserId(telegramUserId: string): Promise<TelegramUser | null> {
    if (!this.db.isAvailable()) {
      await this.ensureLocalStoreLoaded();
      return this.localStore.get(telegramUserId) ?? null;
    }

    const rows = await this.db.query<TelegramUserRow[]>(
      "SELECT * FROM telegram_users WHERE telegram_user_id = ?",
      [telegramUserId]
    );

    if (rows.length === 0) return null;
    return this.rowToUser(rows[0]!);
  }

  /** Find user by device ID */
  async findByDeviceId(deviceId: string): Promise<TelegramUser | null> {
    if (!this.db.isAvailable()) {
      await this.ensureLocalStoreLoaded();
      for (const user of this.localStore.values()) {
        if (user.deviceId === deviceId) return user;
      }
      return null;
    }

    const rows = await this.db.query<TelegramUserRow[]>(
      "SELECT * FROM telegram_users WHERE device_id = ?",
      [deviceId]
    );

    if (rows.length === 0) return null;
    return this.rowToUser(rows[0]!);
  }

  /** Create or update a Telegram user */
  async upsert(data: TelegramUserCreate): Promise<TelegramUser> {
    if (!this.db.isAvailable()) {
      return this.upsertLocal(data);
    }

    // Check if user exists
    const existing = await this.findByTelegramUserId(data.telegramUserId);

    if (existing) {
      // Update existing user — also update device_id if provided
      await this.db.execute(
        `UPDATE telegram_users SET
          hub_id = ?,
          agent_id = ?,
          device_id = ?,
          telegram_username = ?,
          telegram_first_name = ?,
          telegram_last_name = ?
        WHERE telegram_user_id = ?`,
        [
          data.hubId,
          data.agentId,
          data.deviceId ?? existing.deviceId,
          data.telegramUsername ?? null,
          data.telegramFirstName ?? null,
          data.telegramLastName ?? null,
          data.telegramUserId,
        ]
      );

      const updated = await this.findByTelegramUserId(data.telegramUserId);
      return updated!;
    }

    // Create new user with provided or generated device ID
    const deviceId = data.deviceId ?? `tg-${generateEncryptedId()}`;

    await this.db.execute(
      `INSERT INTO telegram_users (
        telegram_user_id, hub_id, agent_id, device_id,
        telegram_username, telegram_first_name, telegram_last_name
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        data.telegramUserId,
        data.hubId,
        data.agentId,
        deviceId,
        data.telegramUsername ?? null,
        data.telegramFirstName ?? null,
        data.telegramLastName ?? null,
      ]
    );

    const created = await this.findByTelegramUserId(data.telegramUserId);
    return created!;
  }

  // ── Local file-backed store (local development only) ──
  //
  // When MYSQL_DSN is not set the methods below provide a simple JSON-file
  // persistence layer so Telegram user bindings survive gateway restarts.
  // This is NOT intended for production use — production always uses MySQL.

  /** Load store from JSON file on first access */
  private async ensureLocalStoreLoaded(): Promise<void> {
    if (this.localStoreLoaded) return;
    this.localStoreLoaded = true;

    try {
      const data = await readFile(LOCAL_STORE_PATH, "utf-8");
      const records = JSON.parse(data) as Record<string, TelegramUser>;
      for (const [key, user] of Object.entries(records)) {
        // Restore Date objects from JSON strings
        user.createdAt = new Date(user.createdAt);
        user.updatedAt = new Date(user.updatedAt);
        this.localStore.set(key, user);
      }
      this.logger.log(`Loaded ${this.localStore.size} Telegram user(s) from ${LOCAL_STORE_PATH}`);
    } catch {
      // File doesn't exist or is invalid — start fresh
    }
  }

  /** Persist store to JSON file */
  private async saveLocalStore(): Promise<void> {
    const obj: Record<string, TelegramUser> = {};
    for (const [key, user] of this.localStore) {
      obj[key] = user;
    }
    await mkdir(LOCAL_STORE_DIR, { recursive: true });
    await writeFile(LOCAL_STORE_PATH, JSON.stringify(obj, null, 2), "utf-8");
  }

  /** Upsert to local file store */
  private async upsertLocal(data: TelegramUserCreate): Promise<TelegramUser> {
    await this.ensureLocalStoreLoaded();

    const existing = this.localStore.get(data.telegramUserId);
    const now = new Date();

    const user: TelegramUser = {
      telegramUserId: data.telegramUserId,
      hubId: data.hubId,
      agentId: data.agentId,
      deviceId: data.deviceId ?? existing?.deviceId ?? `tg-${generateEncryptedId()}`,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      telegramUsername: data.telegramUsername,
      telegramFirstName: data.telegramFirstName,
      telegramLastName: data.telegramLastName,
    };

    this.localStore.set(data.telegramUserId, user);
    await this.saveLocalStore();
    this.logger.debug(`Local upsert: telegramUserId=${data.telegramUserId}`);
    return user;
  }

  /** Convert database row to TelegramUser object */
  private rowToUser(row: TelegramUserRow): TelegramUser {
    return {
      telegramUserId: row.telegram_user_id,
      hubId: row.hub_id,
      agentId: row.agent_id,
      deviceId: row.device_id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      telegramUsername: row.telegram_username ?? undefined,
      telegramFirstName: row.telegram_first_name ?? undefined,
      telegramLastName: row.telegram_last_name ?? undefined,
    };
  }
}
