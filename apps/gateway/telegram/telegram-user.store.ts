/**
 * Telegram user store.
 *
 * Uses MySQL when MYSQL_DSN is set (production).
 * Falls back to in-memory storage when database is unavailable (local development).
 */

import { Inject, Injectable, Logger } from "@nestjs/common";
import { generateEncryptedId } from "@multica/utils";
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

@Injectable()
export class TelegramUserStore {
  private readonly logger = new Logger(TelegramUserStore.name);
  /** In-memory fallback, keyed by telegramUserId */
  private readonly memoryStore = new Map<string, TelegramUser>();

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  /** Find user by Telegram user ID */
  async findByTelegramUserId(telegramUserId: string): Promise<TelegramUser | null> {
    if (!this.db.isAvailable()) {
      return this.memoryStore.get(telegramUserId) ?? null;
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
      for (const user of this.memoryStore.values()) {
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
      return this.upsertMemory(data);
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

  /** In-memory upsert for local development */
  private upsertMemory(data: TelegramUserCreate): TelegramUser {
    const existing = this.memoryStore.get(data.telegramUserId);
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

    this.memoryStore.set(data.telegramUserId, user);
    this.logger.debug(`In-memory upsert: telegramUserId=${data.telegramUserId}`);
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
