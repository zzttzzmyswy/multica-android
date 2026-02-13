/**
 * In-memory short code store for Telegram deep link connection flow.
 *
 * Maps short alphanumeric codes to full ConnectionInfo objects.
 * Codes are one-time use and expire with the underlying connection token.
 */

import { randomBytes } from "node:crypto";
import type { ConnectionInfo } from "@multica/store/connection";

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const CODE_LENGTH = 12;
const CLEANUP_INTERVAL_MS = 10_000;

interface CodeEntry {
  connectionInfo: ConnectionInfo;
}

export class ShortCodeStore {
  private codes = new Map<string, CodeEntry>();
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.cleanupTimer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
  }

  /** Store connection info and return a short code. */
  store(connectionInfo: ConnectionInfo): string {
    const code = this.generateCode();
    this.codes.set(code, { connectionInfo });
    return code;
  }

  /** Retrieve and delete a code (one-time use). Returns null if expired or not found. */
  consume(code: string): ConnectionInfo | null {
    const entry = this.codes.get(code);
    if (!entry) return null;

    this.codes.delete(code);

    // Check expiry
    if (Date.now() > entry.connectionInfo.expires) {
      return null;
    }

    return entry.connectionInfo;
  }

  /** Stop cleanup interval and clear all codes. */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.codes.clear();
  }

  private generateCode(): string {
    const bytes = randomBytes(CODE_LENGTH);
    let code = "";
    for (let i = 0; i < CODE_LENGTH; i++) {
      code += CHARS[bytes[i]! % CHARS.length];
    }
    // Ensure uniqueness (extremely unlikely collision, but safe)
    if (this.codes.has(code)) return this.generateCode();
    return code;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [code, entry] of this.codes) {
      if (now > entry.connectionInfo.expires) {
        this.codes.delete(code);
      }
    }
  }
}
