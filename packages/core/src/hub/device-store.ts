import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { DATA_DIR } from "@multica/utils";

// ============ Types ============

interface TokenEntry {
  token: string;
  agentId: string;
  conversationId: string;
  expiresAt: number;
}

export interface DeviceMeta {
  userAgent?: string;
  platform?: string;
  language?: string;
  clientName?: string;
}

export interface DeviceEntry {
  deviceId: string;
  agentId: string;
  conversationIds: string[];
  addedAt: number;
  meta?: DeviceMeta | undefined;
}

// ============ Persistence ============

interface WhitelistFile {
  version: number;
  devices: DeviceEntry[];
}

const DEVICES_DIR = join(DATA_DIR, "client-devices");
const DEVICES_FILE = join(DEVICES_DIR, "whitelist.json");

interface DeviceStoreOptions {
  devicesFile?: string;
}

function normalizeConversationIds(
  input: unknown,
  fallbackConversationId: string,
): string[] {
  const ids = new Set<string>();
  if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item !== "string") continue;
      const id = item.trim();
      if (id) ids.add(id);
    }
  }
  const fallback = fallbackConversationId.trim();
  if (ids.size === 0 && fallback) {
    ids.add(fallback);
  }
  return Array.from(ids);
}

// ============ DeviceStore ============

export class DeviceStore {
  private readonly devicesDir: string;
  private readonly devicesFile: string;
  /** One-time tokens (in-memory only, not persisted) */
  private readonly tokens = new Map<string, TokenEntry>();
  /** Allowed device IDs (persisted to disk) */
  private readonly allowedDevices = new Map<string, DeviceEntry>();

  constructor(options?: DeviceStoreOptions) {
    this.devicesFile = options?.devicesFile ?? DEVICES_FILE;
    this.devicesDir = options?.devicesFile ? dirname(options.devicesFile) : DEVICES_DIR;
    // Restore from persistent storage
    for (const entry of this.loadDevices()) {
      this.allowedDevices.set(entry.deviceId, entry);
    }
  }

  // ---- Token management ----

  /** Register a one-time token (called when QR code is generated) */
  registerToken(token: string, agentId: string, conversationId: string, expiresAt: number): void {
    // Clean up expired tokens to prevent accumulation
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (now > entry.expiresAt) this.tokens.delete(key);
    }
    this.tokens.set(token, { token, agentId, conversationId, expiresAt });
  }

  /** Validate and consume a token (one-time use). Returns agentId if valid, null otherwise. */
  consumeToken(token: string): { agentId: string; conversationId: string } | null {
    const entry = this.tokens.get(token);
    if (!entry) return null;
    // Always delete — consumed or expired
    this.tokens.delete(token);
    if (Date.now() > entry.expiresAt) return null;
    return { agentId: entry.agentId, conversationId: entry.conversationId };
  }

  // ---- Device whitelist ----

  /** Add a device to the whitelist (called after token verification + user confirmation) */
  allowDevice(deviceId: string, agentId: string, conversationId: string, meta?: DeviceMeta): void {
    const existing = this.allowedDevices.get(deviceId);
    const conversationIds = existing && existing.agentId === agentId
      ? normalizeConversationIds(existing.conversationIds, conversationId)
      : normalizeConversationIds([], conversationId);
    if (!conversationIds.includes(conversationId)) {
      conversationIds.push(conversationId);
    }

    const entry: DeviceEntry = {
      deviceId,
      agentId,
      conversationIds,
      addedAt: existing?.addedAt ?? Date.now(),
      meta,
    };
    this.allowedDevices.set(deviceId, entry);
    this.persist();
  }

  /** Check if a device is in the whitelist */
  isAllowed(
    deviceId: string,
    conversationId?: string,
  ): { agentId: string; conversationIds: string[] } | null {
    const entry = this.allowedDevices.get(deviceId);
    if (!entry) return null;

    if (conversationId !== undefined && !entry.conversationIds.includes(conversationId)) {
      return null;
    }

    return {
      agentId: entry.agentId,
      conversationIds: [...entry.conversationIds],
    };
  }

  /** Grant an additional conversation scope to an existing device. */
  allowConversation(deviceId: string, conversationId: string): boolean {
    const entry = this.allowedDevices.get(deviceId);
    if (!entry) return false;
    if (entry.conversationIds.includes(conversationId)) return true;
    entry.conversationIds.push(conversationId);
    this.allowedDevices.set(deviceId, entry);
    this.persist();
    return true;
  }

  /** Remove a device from the whitelist */
  revokeDevice(deviceId: string): boolean {
    const deleted = this.allowedDevices.delete(deviceId);
    if (deleted) this.persist();
    return deleted;
  }

  /** List all whitelisted devices */
  listDevices(): DeviceEntry[] {
    return Array.from(this.allowedDevices.values());
  }

  private persist(): void {
    this.saveDevices(Array.from(this.allowedDevices.values()));
  }

  private ensureDir(): void {
    if (!existsSync(this.devicesDir)) {
      mkdirSync(this.devicesDir, { recursive: true });
    }
  }

  private loadDevices(): DeviceEntry[] {
    if (!existsSync(this.devicesFile)) return [];
    try {
      const raw = JSON.parse(readFileSync(this.devicesFile, "utf-8"));
      const devices = Array.isArray(raw) ? raw : (raw as WhitelistFile).devices ?? [];
      if (!Array.isArray(devices)) return [];

      const normalized: DeviceEntry[] = [];
      for (const item of devices) {
        if (!item || typeof item !== "object") continue;
        const rawDeviceId = (item as { deviceId?: unknown }).deviceId;
        const rawAgentId = (item as { agentId?: unknown }).agentId;
        if (typeof rawDeviceId !== "string" || typeof rawAgentId !== "string") continue;
        const deviceId = rawDeviceId.trim();
        const agentId = rawAgentId.trim();
        if (!deviceId || !agentId) continue;
        const fallbackConversationId = typeof (item as { conversationId?: unknown }).conversationId === "string"
          ? (item as { conversationId: string }).conversationId
          : agentId;
        normalized.push({
          deviceId,
          agentId,
          conversationIds: normalizeConversationIds(
            (item as { conversationIds?: unknown }).conversationIds,
            fallbackConversationId,
          ),
          addedAt: typeof (item as { addedAt?: unknown }).addedAt === "number"
            ? (item as { addedAt: number }).addedAt
            : Date.now(),
          meta: (item as { meta?: DeviceMeta }).meta,
        });
      }
      return normalized;
    } catch {
      return [];
    }
  }

  private saveDevices(devices: DeviceEntry[]): void {
    this.ensureDir();
    const data: WhitelistFile = { version: 2, devices };
    writeFileSync(this.devicesFile, JSON.stringify(data, null, 2), "utf-8");
  }
}
