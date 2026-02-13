/**
 * Image resize wrapper for the read tool.
 *
 * Wraps the read tool from pi-coding-agent to automatically downscale
 * oversized images returned in tool results. Uses macOS `sips` for resize
 * (no extra dependencies required).
 */

import type { AgentTool, AgentToolResult } from "@mariozechner/pi-agent-core";
import { execFile } from "node:child_process";
import { writeFile, readFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

/** Max decoded image binary size (1MB) */
const MAX_IMAGE_BYTES = 1 * 1024 * 1024;

/** Max image dimension in pixels per side */
const MAX_IMAGE_DIMENSION_PX = 2000;

/** JPEG quality for resized output */
const JPEG_QUALITY = 80;

type ContentBlock = AgentToolResult<unknown>["content"][number];

function isImageBlock(block: unknown): block is { type: "image"; data: string; [key: string]: unknown } {
  return (
    !!block &&
    typeof block === "object" &&
    (block as any).type === "image" &&
    typeof (block as any).data === "string"
  );
}

/**
 * Run sips command and return output buffer.
 * Only available on macOS.
 */
function runSips(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile("/usr/bin/sips", args, { timeout: 20_000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout);
    });
  });
}

/**
 * Get image dimensions via sips.
 */
async function getImageDimensions(
  buffer: Buffer,
  tmpDir: string,
): Promise<{ width: number; height: number } | null> {
  const input = join(tmpDir, "in.img");
  await writeFile(input, buffer);

  try {
    const stdout = await runSips(["-g", "pixelWidth", "-g", "pixelHeight", input]);
    const w = stdout.match(/pixelWidth:\s*(\d+)/);
    const h = stdout.match(/pixelHeight:\s*(\d+)/);
    if (w?.[1] && h?.[1]) {
      return { width: parseInt(w[1], 10), height: parseInt(h[1], 10) };
    }
  } catch {
    // sips not available or failed
  }
  return null;
}

/**
 * Resize image to JPEG via sips.
 */
async function resizeWithSips(
  buffer: Buffer,
  maxSide: number,
  quality: number,
  tmpDir: string,
): Promise<Buffer> {
  const input = join(tmpDir, "in.img");
  const output = join(tmpDir, "out.jpg");
  await writeFile(input, buffer);

  await runSips([
    "-Z", String(maxSide),
    "-s", "format", "jpeg",
    "-s", "formatOptions", String(quality),
    input,
    "--out", output,
  ]);

  return readFile(output);
}

/**
 * Check if image needs resize and perform it if necessary.
 * Returns the original base64 if no resize needed or if resize fails.
 */
async function maybeResizeImage(base64Data: string): Promise<{ base64: string; mimeType?: string; resized: boolean }> {
  const buffer = Buffer.from(base64Data, "base64");
  const overSize = buffer.byteLength > MAX_IMAGE_BYTES;

  // Quick check: if small enough by bytes and we can't check dimensions, pass through
  if (!overSize && process.platform !== "darwin") {
    return { base64: base64Data, resized: false };
  }

  // On macOS, use sips to check dimensions and resize if needed
  if (process.platform === "darwin") {
    const tmpDir = await mkdtemp(join(tmpdir(), "multica-img-"));
    try {
      const dims = await getImageDimensions(buffer, tmpDir);

      // If we can get dimensions and everything is within limits, pass through
      if (dims && !overSize && dims.width <= MAX_IMAGE_DIMENSION_PX && dims.height <= MAX_IMAGE_DIMENSION_PX) {
        return { base64: base64Data, resized: false };
      }

      // Need resize
      const maxDim = dims ? Math.max(dims.width, dims.height) : MAX_IMAGE_DIMENSION_PX;
      const targetSide = Math.min(MAX_IMAGE_DIMENSION_PX, maxDim);
      const resized = await resizeWithSips(buffer, targetSide, JPEG_QUALITY, tmpDir);

      // If still too large, try progressively smaller sizes
      if (resized.byteLength > MAX_IMAGE_BYTES) {
        for (const side of [1600, 1200, 800]) {
          const smaller = await resizeWithSips(buffer, side, JPEG_QUALITY, tmpDir);
          if (smaller.byteLength <= MAX_IMAGE_BYTES) {
            return { base64: smaller.toString("base64"), mimeType: "image/jpeg", resized: true };
          }
        }
      }

      return { base64: resized.toString("base64"), mimeType: "image/jpeg", resized: true };
    } catch {
      // sips failed, pass through original
      return { base64: base64Data, resized: false };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  // Non-macOS: pass through (future: add sharp support)
  return { base64: base64Data, resized: false };
}

/**
 * Process tool result content blocks, resizing oversized images.
 */
async function processResultContent(content: ContentBlock[]): Promise<ContentBlock[]> {
  const result: ContentBlock[] = [];

  for (const block of content) {
    if (!isImageBlock(block)) {
      result.push(block);
      continue;
    }

    const decoded = Buffer.from(block.data, "base64");
    // Skip small images entirely
    if (decoded.byteLength <= MAX_IMAGE_BYTES) {
      result.push(block);
      continue;
    }

    try {
      const resized = await maybeResizeImage(block.data);
      if (resized.resized) {
        result.push({ ...block, data: resized.base64 } as ContentBlock);
      } else {
        result.push(block);
      }
    } catch {
      result.push(block);
    }
  }

  return result;
}

/**
 * Wrap the read tool to automatically resize oversized images in results.
 */
export function wrapReadToolWithImageResize(
  tool: AgentTool<any, any>,
): AgentTool<any, any> {
  const originalExecute = tool.execute;

  return {
    ...tool,
    execute: async (...args: Parameters<typeof originalExecute>) => {
      const result = await originalExecute(...args);

      // Only process results with content arrays
      const resultAny = result as any;
      if (!resultAny?.content || !Array.isArray(resultAny.content)) {
        return result;
      }

      // Check if there are any image blocks worth processing
      const hasLargeImages = resultAny.content.some(
        (block: unknown) =>
          isImageBlock(block) && Buffer.from((block as any).data, "base64").byteLength > MAX_IMAGE_BYTES,
      );
      if (!hasLargeImages) return result;

      const processed = await processResultContent(resultAny.content);
      return { ...resultAny, content: processed } as typeof result;
    },
  };
}
