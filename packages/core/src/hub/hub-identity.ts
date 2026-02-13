import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR, generateEncryptedId, isValidEncryptedId } from "@multica/utils";

const HUB_ID_FILE = join(DATA_DIR, "hub-id");

/**
 * 获取当前 Hub 的 ID（加密后的 40 字符格式）。
 * 首次调用时生成加密 ID 并持久化到 ~/.super-multica/hub-id，
 * 后续调用直接读取。
 */
export function getHubId(): string {
  try {
    const existing = readFileSync(HUB_ID_FILE, "utf-8").trim();
    if (isValidEncryptedId(existing)) {
      return existing;
    }
  } catch {
    // File doesn't exist or read error
  }

  // Generate new encrypted ID
  const id = generateEncryptedId();
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(HUB_ID_FILE, id, "utf-8");
  return id;
}
