/**
 * Image description via OpenAI Vision API.
 *
 * Called by ChannelManager before the message reaches the Agent,
 * so the Agent only ever sees a text description of the image.
 *
 * @see docs/channels/media-handling.md — Media processing pipeline
 */

import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import { credentialManager } from "../agent/credentials.js";

/** Map file extension to MIME type for common image formats */
function mimeFromExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  switch (ext) {
    case ".png": return "image/png";
    case ".gif": return "image/gif";
    case ".webp": return "image/webp";
    default: return "image/jpeg";
  }
}

/**
 * Describe an image using OpenAI Vision API (gpt-4o-mini).
 *
 * @param filePath - Local path to the image file
 * @returns Text description, or null if no API key configured
 */
export async function describeImage(filePath: string): Promise<string | null> {
  const config = credentialManager.getLlmProviderConfig("openai");
  const apiKey = config?.apiKey;
  if (!apiKey) return null;

  const buffer = await readFile(filePath);
  const base64 = buffer.toString("base64");
  const mimeType = mimeFromExt(filePath);
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Describe this image concisely. Focus on the main content and any text visible in the image.",
            },
            {
              type: "image_url",
              image_url: { url: dataUrl },
            },
          ],
        },
      ],
      max_tokens: 500,
    }),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Vision API error: HTTP ${res.status} ${errText}`);
  }

  const result = (await res.json()) as {
    choices: Array<{ message: { content: string } }>;
  };
  return result.choices[0]?.message.content ?? null;
}
