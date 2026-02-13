import { join } from "path";
import { mkdirSync } from "fs";
import { appendFile } from "fs/promises";
import { resolveBaseDir, type SessionStorageOptions } from "./session/storage.js";

export interface RunLog {
  log(event: string, data?: Record<string, unknown>): void;
  flush(): Promise<void>;
}

class FileRunLog implements RunLog {
  private readonly filePath: string;
  private buffer: string[] = [];
  private flushPromise: Promise<void> = Promise.resolve();
  private flushScheduled = false;

  constructor(sessionId: string, options?: SessionStorageOptions) {
    const sessionDir = join(resolveBaseDir(options), sessionId);
    try {
      mkdirSync(sessionDir, { recursive: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        mkdirSync(sessionDir, { recursive: true });
      } else {
        throw err;
      }
    }
    this.filePath = join(sessionDir, "run-log.jsonl");
  }

  log(event: string, data?: Record<string, unknown>): void {
    const entry = { ts: Date.now(), event, ...data };
    this.buffer.push(JSON.stringify(entry));
    this.scheduleFlush();
  }

  async flush(): Promise<void> {
    this.drainBuffer();
    await this.flushPromise;
  }

  private scheduleFlush(): void {
    if (this.flushScheduled) return;
    this.flushScheduled = true;
    // Microtask flush — batches synchronous log() calls into one write
    queueMicrotask(() => {
      this.flushScheduled = false;
      this.drainBuffer();
    });
  }

  private drainBuffer(): void {
    if (this.buffer.length === 0) return;
    const lines = this.buffer.join("\n") + "\n";
    this.buffer = [];
    this.flushPromise = this.flushPromise
      .then(() => appendFile(this.filePath, lines, "utf8"))
      .catch((err) => {
        console.error(`[RunLog] Write failed: ${err}`);
      });
  }
}

class NoopRunLog implements RunLog {
  log(): void {}
  async flush(): Promise<void> {}
}

export function createRunLog(
  enabled: boolean,
  sessionId: string,
  options?: SessionStorageOptions,
): RunLog {
  if (enabled) {
    return new FileRunLog(sessionId, options);
  }
  return new NoopRunLog();
}
