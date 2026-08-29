import { describe, expect, it, vi } from "vitest";

// Node vitest lane never touches native modules — mock the FS + share sheet
// (same shape as downloads-store.test.ts uses).
vi.mock("expo-file-system", () => {
  const store = new Map<string, string>();
  return {
    __fsStore: store,
    File: class MockFile {
      uri: string;
      exists: boolean;
      constructor(base: { uri?: string }, name?: string) {
        this.uri = [`${base.uri ?? ""}`, name ?? ""].join("/");
        this.exists = store.has(this.uri);
      }
      text(): Promise<string> {
        return Promise.resolve(store.get(this.uri) ?? "");
      }
      write(content: string, _opts?: { encoding?: string }): void {
        store.set(this.uri, content);
      }
      delete(): void {
        store.delete(this.uri);
        this.exists = false;
      }
    },
    Paths: { cache: { uri: "file:///cache" } },
  };
});

vi.mock("expo-sharing", () => ({
  isAvailableAsync: vi.fn(async () => true),
  shareAsync: vi.fn(async () => {}),
}));

import {
  exportFilename,
  exportMimeType,
  shareExportDataUrl,
  shareExportText,
  stripDataUrlPrefix,
} from "./export-file";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";

describe("stripDataUrlPrefix", () => {
  it("strips the comma-separated data: URL prefix", () => {
    expect(stripDataUrlPrefix("data:image/png;base64,QQ==")).toBe("QQ==");
  });

  it("returns the string as-is when there is no comma", () => {
    expect(stripDataUrlPrefix("abc")).toBe("abc");
    expect(stripDataUrlPrefix("")).toBe("");
  });
});

describe("exportMimeType", () => {
  it("maps kinds to share intents", () => {
    expect(exportMimeType("svg")).toBe("image/svg+xml");
    expect(exportMimeType("png")).toBe("image/png");
    expect(exportMimeType("mmd")).toBe("text/plain");
  });
});

describe("exportFilename", () => {
  it("uses the mermaid-<stamp>.<ext> shape", () => {
    expect(exportFilename("svg", 123)).toBe("mermaid-123.svg");
    expect(exportFilename("png", 123)).toBe("mermaid-123.png");
    expect(exportFilename("mmd", 123)).toBe("mermaid-123.mmd");
  });
});

describe("shareExportText / shareExportDataUrl", () => {
  it("writes text to the cache dir and opens the share sheet", async () => {
    await shareExportText("out.svg", "<svg/>", "image/svg+xml");
    const store = (FileSystem as unknown as { __fsStore: Map<string, string> })
      .__fsStore;
    expect(store.get("file:///cache/out.svg")).toBe("<svg/>");
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/out.svg", {
      mimeType: "image/svg+xml",
    });
  });

  it("strips the data: URL prefix before writing base64 payloads", async () => {
    await shareExportDataUrl("out.png", "data:image/png;base64,QQ==", "image/png");
    const store = (FileSystem as unknown as { __fsStore: Map<string, string> })
      .__fsStore;
    expect(store.get("file:///cache/out.png")).toBe("QQ==");
    expect(Sharing.shareAsync).toHaveBeenCalledWith("file:///cache/out.png", {
      mimeType: "image/png",
    });
  });
});