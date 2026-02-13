import { join } from "path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { appendFile, writeFile } from "fs/promises";
import { createHash } from "node:crypto";
import type { SessionEntry } from "./types.js";
import { DATA_DIR } from "@multica/utils";
import { acquireSessionWriteLock } from "./session-write-lock.js";

export type SessionStorageOptions = {
  baseDir?: string | undefined;
};

/** Minimum base64 data length to externalize (32KB decoded ≈ 43KB base64) */
const MIN_EXTERNALIZE_B64_LENGTH = 43_000;

export function resolveBaseDir(options?: SessionStorageOptions) {
  return options?.baseDir ?? join(DATA_DIR, "sessions");
}

export function resolveSessionDir(sessionId: string, options?: SessionStorageOptions) {
  return join(resolveBaseDir(options), sessionId);
}

export function resolveSessionPath(sessionId: string, options?: SessionStorageOptions) {
  return join(resolveSessionDir(sessionId, options), "session.jsonl");
}

export function resolveMediaDir(sessionId: string, options?: SessionStorageOptions) {
  return join(resolveSessionDir(sessionId, options), "media");
}

export function ensureSessionDir(sessionId: string, options?: SessionStorageOptions) {
  const dir = resolveSessionDir(sessionId, options);
  // mkdirSync with recursive is idempotent (no-op if dir exists),
  // so skip the existsSync check to avoid a TOCTOU race.
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    // Retry once on transient ENOENT (macOS APFS race condition)
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      mkdirSync(dir, { recursive: true });
    } else {
      throw err;
    }
  }
}

// ─── Image Externalization ──────────────────────────────────────────────────

function contentHash(base64Data: string): string {
  const buffer = Buffer.from(base64Data, "base64");
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

function ensureMediaDir(sessionId: string, options?: SessionStorageOptions): void {
  const dir = resolveMediaDir(sessionId, options);
  try {
    mkdirSync(dir, { recursive: true });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      mkdirSync(dir, { recursive: true });
    } else {
      throw err;
    }
  }
}

function saveImageBinary(
  sessionId: string,
  hash: string,
  base64Data: string,
  options?: SessionStorageOptions,
): void {
  ensureMediaDir(sessionId, options);
  const filePath = join(resolveMediaDir(sessionId, options), `${hash}.bin`);
  if (existsSync(filePath)) return; // dedup
  const buffer = Buffer.from(base64Data, "base64");
  writeFileSync(filePath, buffer);
}

/**
 * Replace a single image content block with an external file reference.
 * Returns the original block unchanged if it's not an externalizable image.
 */
function externalizeBlock(
  block: any,
  sessionId: string,
  options?: SessionStorageOptions,
): any {
  if (!block || typeof block !== "object" || block.type !== "image") return block;

  // Format A: { type: "image", data: "<base64>" }
  if (typeof block.data === "string" && block.data.length > MIN_EXTERNALIZE_B64_LENGTH) {
    const hash = contentHash(block.data);
    const relPath = `media/${hash}.bin`;
    saveImageBinary(sessionId, hash, block.data, options);
    const { data: _removed, ...rest } = block;
    return { ...rest, $ref: relPath };
  }

  // Format B: { type: "image", source: { type: "base64", data: "<base64>" } }
  if (
    block.source &&
    typeof block.source === "object" &&
    block.source.type === "base64" &&
    typeof block.source.data === "string" &&
    block.source.data.length > MIN_EXTERNALIZE_B64_LENGTH
  ) {
    const hash = contentHash(block.source.data);
    const relPath = `media/${hash}.bin`;
    saveImageBinary(sessionId, hash, block.source.data, options);
    return { ...block, source: { type: "$ref", path: relPath } };
  }

  return block;
}

/**
 * Restore an externalized image reference back to inline base64 data.
 */
function internalizeBlock(
  block: any,
  sessionId: string,
  options?: SessionStorageOptions,
): any {
  if (!block || typeof block !== "object" || block.type !== "image") return block;

  // Format A ref: { type: "image", $ref: "media/<hash>.bin" }
  if (typeof block.$ref === "string") {
    const filePath = join(resolveSessionDir(sessionId, options), block.$ref);
    try {
      const buffer = readFileSync(filePath);
      const data = buffer.toString("base64");
      const { $ref: _removed, ...rest } = block;
      return { ...rest, data };
    } catch {
      return { type: "text", text: "[Image unavailable: referenced media file not found]" };
    }
  }

  // Format B ref: { type: "image", source: { type: "$ref", path: "media/<hash>.bin" } }
  if (block.source && typeof block.source === "object" && block.source.type === "$ref") {
    const filePath = join(resolveSessionDir(sessionId, options), block.source.path);
    try {
      const buffer = readFileSync(filePath);
      const data = buffer.toString("base64");
      return { ...block, source: { type: "base64", data } };
    } catch {
      return { type: "text", text: "[Image unavailable: referenced media file not found]" };
    }
  }

  return block;
}

/**
 * Walk content blocks (including nested tool_result.content) and apply a transform.
 */
function transformContentBlocks(
  content: any[],
  transformBlock: (block: any) => any,
): { content: any[]; changed: boolean } {
  let changed = false;
  const result: any[] = [];

  for (const block of content) {
    // Handle nested tool_result content
    if (block && typeof block === "object" && block.type === "tool_result" && Array.isArray(block.content)) {
      const inner = transformContentBlocks(block.content, transformBlock);
      if (inner.changed) {
        changed = true;
        result.push({ ...block, content: inner.content });
      } else {
        result.push(block);
      }
      continue;
    }

    const transformed = transformBlock(block);
    if (transformed !== block) changed = true;
    result.push(transformed);
  }

  return { content: result, changed };
}

/**
 * Extract base64 image data from a session entry, save as binary files,
 * and replace with file references.
 */
function externalizeImages(
  entry: SessionEntry,
  sessionId: string,
  options?: SessionStorageOptions,
): SessionEntry {
  if (entry.type !== "message") return entry;

  const message = entry.message as any;
  const content = message.content;
  if (!Array.isArray(content)) return entry;

  const result = transformContentBlocks(content, (block) =>
    externalizeBlock(block, sessionId, options),
  );

  if (!result.changed) return entry;

  return {
    ...entry,
    message: { ...message, content: result.content },
  } as SessionEntry;
}

/**
 * Resolve external file references in a session entry back to inline base64 data.
 */
function internalizeImages(
  entry: SessionEntry,
  sessionId: string,
  options?: SessionStorageOptions,
): SessionEntry {
  if (entry.type !== "message") return entry;

  const message = entry.message as any;
  const content = message.content;
  if (!Array.isArray(content)) return entry;

  const result = transformContentBlocks(content, (block) =>
    internalizeBlock(block, sessionId, options),
  );

  if (!result.changed) return entry;

  return {
    ...entry,
    message: { ...message, content: result.content },
  } as SessionEntry;
}

// ─── Public API ─────────────────────────────────────────────────────────────

export function readEntries(sessionId: string, options?: SessionStorageOptions): SessionEntry[] {
  const filePath = resolveSessionPath(sessionId, options);
  if (!existsSync(filePath)) return [];
  const content = readFileSync(filePath, "utf8");
  const lines = content.split("\n").filter(Boolean);
  const entries: SessionEntry[] = [];
  for (const line of lines) {
    try {
      const raw = JSON.parse(line) as SessionEntry;
      entries.push(internalizeImages(raw, sessionId, options));
    } catch {
      // Skip malformed lines
    }
  }
  return entries;
}

export async function appendEntry(
  sessionId: string,
  entry: SessionEntry,
  options?: SessionStorageOptions,
) {
  ensureSessionDir(sessionId, options);
  const filePath = resolveSessionPath(sessionId, options);
  const lock = await acquireSessionWriteLock({ sessionFile: filePath });
  try {
    const externalized = externalizeImages(entry, sessionId, options);
    await appendFile(filePath, `${JSON.stringify(externalized)}\n`, "utf8");
  } finally {
    await lock.release();
  }
}

export async function writeEntries(
  sessionId: string,
  entries: SessionEntry[],
  options?: SessionStorageOptions,
) {
  ensureSessionDir(sessionId, options);
  const filePath = resolveSessionPath(sessionId, options);
  const lock = await acquireSessionWriteLock({ sessionFile: filePath });
  try {
    const content = entries
      .map((entry) => JSON.stringify(externalizeImages(entry, sessionId, options)))
      .join("\n");
    await writeFile(filePath, content ? `${content}\n` : "", "utf8");
  } finally {
    await lock.release();
  }
}
