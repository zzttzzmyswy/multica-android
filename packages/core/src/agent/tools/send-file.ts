/**
 * send_file tool — sends a file to the active messaging channel.
 *
 * Available when the agent is connected to a channel (Telegram, etc.).
 * Auto-detects media type from file extension if not specified.
 */

import { Type } from "@sinclair/typebox";
import type { AgentTool } from "@mariozechner/pi-agent-core";
import { stat } from "node:fs/promises";
import { basename, extname } from "node:path";

const SendFileSchema = Type.Object({
  file_path: Type.String({
    description: "Absolute path to the file to send.",
  }),
  caption: Type.Optional(
    Type.String({
      description: "Optional caption text to accompany the file.",
    }),
  ),
  type: Type.Optional(
    Type.Union(
      [
        Type.Literal("auto"),
        Type.Literal("photo"),
        Type.Literal("document"),
        Type.Literal("video"),
        Type.Literal("audio"),
        Type.Literal("voice"),
      ],
      {
        description:
          'Media type. "auto" (default) detects from file extension. Use "document" to force file attachment.',
      },
    ),
  ),
});

type SendFileArgs = {
  file_path: string;
  caption?: string;
  type?: "auto" | "photo" | "document" | "video" | "audio" | "voice";
};

type SendFileResult = {
  sent: boolean;
  file_path: string;
  detected_type: string;
  error?: string;
};

/** Callback provided by the Hub to route files through channels or gateway. */
export type SendFileCallback = (
  filePath: string,
  caption: string | undefined,
  type: string,
) => Promise<boolean>;

const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp"]);
const VIDEO_EXTENSIONS = new Set([".mp4", ".webm", ".mov", ".avi", ".mkv"]);
const AUDIO_EXTENSIONS = new Set([".mp3", ".ogg", ".wav", ".m4a", ".flac", ".aac"]);

/** Detect outbound media type from file extension. */
function detectMediaType(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (PHOTO_EXTENSIONS.has(ext)) return "photo";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  return "document";
}

export function createSendFileTool(
  onSendFile: SendFileCallback,
): AgentTool<typeof SendFileSchema, SendFileResult> {
  return {
    name: "send_file",
    label: "Send File",
    description:
      "Send a file (photo, document, video, audio) to the active messaging channel (e.g. Telegram). " +
      "The file must exist on the local filesystem. " +
      'Type is auto-detected from extension unless overridden. Use type="document" to force file attachment.',
    parameters: SendFileSchema,
    execute: async (_toolCallId, args) => {
      const { file_path, caption, type } = args as SendFileArgs;

      // Validate file exists
      try {
        const fileStat = await stat(file_path);
        if (!fileStat.isFile()) {
          return {
            content: [{ type: "text", text: `Error: ${file_path} is not a file` }],
            details: { sent: false, file_path, detected_type: "unknown", error: "Not a file" },
          };
        }
      } catch {
        return {
          content: [{ type: "text", text: `Error: File not found: ${file_path}` }],
          details: { sent: false, file_path, detected_type: "unknown", error: "File not found" },
        };
      }

      const mediaType = type && type !== "auto" ? type : detectMediaType(file_path);

      const sent = await onSendFile(file_path, caption, mediaType);
      if (!sent) {
        return {
          content: [{ type: "text", text: "No active channel conversation to send the file to." }],
          details: { sent: false, file_path, detected_type: mediaType, error: "No active channel" },
        };
      }

      const filename = basename(file_path);
      return {
        content: [{ type: "text", text: `File sent: ${filename} (${mediaType})` }],
        details: { sent: true, file_path, detected_type: mediaType },
      };
    },
  };
}
