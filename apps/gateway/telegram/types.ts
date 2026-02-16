/**
 * Telegram user types for Gateway.
 */

/** Telegram user record stored in database */
export interface TelegramUser {
  telegramUserId: string;
  hubId: string;
  agentId: string;
  /** Current active conversation for this Telegram thread. */
  conversationId?: string | undefined;
  deviceId: string;
  createdAt: Date;
  updatedAt: Date;
  telegramUsername?: string | undefined;
  telegramFirstName?: string | undefined;
  telegramLastName?: string | undefined;
}

/** Data required to create/update a Telegram user */
export interface TelegramUserCreate {
  telegramUserId: string;
  hubId: string;
  agentId: string;
  conversationId?: string | undefined;
  deviceId?: string;
  telegramUsername?: string | undefined;
  telegramFirstName?: string | undefined;
  telegramLastName?: string | undefined;
}

// Re-export VirtualDeviceHandler from parent for convenience
export type { VirtualDeviceHandler } from "../types.js";
