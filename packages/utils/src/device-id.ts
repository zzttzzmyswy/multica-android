/**
 * Encrypted Device/Hub ID generation utilities
 *
 * All device identifiers (Device ID, Hub ID, etc.) use the same encryption format:
 * 1. Generate UUID
 * 2. sha256(uuid).slice(0, 32) = firstHash
 * 3. sha256(firstHash).slice(0, 8) + firstHash = 40 hex chars
 *
 * This is consistent with copilot-search/devv-sdk.
 */

import { createHash } from "node:crypto";
import { v7 as uuidv7 } from "uuid";

/**
 * SHA-256 hash function (Node.js)
 */
function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Generate an encrypted device/hub ID (40 hex characters)
 *
 * Algorithm:
 * 1. Generate UUIDv7
 * 2. sha256(uuid).slice(0, 32) = firstHash
 * 3. sha256(firstHash).slice(0, 8) + firstHash = 40 chars
 */
export function generateEncryptedId(): string {
  const uuid = uuidv7();
  const firstHash = sha256(uuid).slice(0, 32);
  return sha256(firstHash).slice(0, 8) + firstHash;
}

/**
 * Validate encrypted ID format (40 hex characters)
 */
export function isValidEncryptedId(id: string): boolean {
  return typeof id === "string" && /^[a-f0-9]{40}$/i.test(id);
}

/**
 * Encrypt a raw UUID to the 40-char format
 * Used when migrating old UUIDs to encrypted format
 */
export function encryptRawId(rawId: string): string {
  const firstHash = sha256(rawId).slice(0, 32);
  return sha256(firstHash).slice(0, 8) + firstHash;
}
