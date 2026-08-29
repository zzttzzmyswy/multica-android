/**
 * File-export helpers for the Mermaid fullscreen viewer (SVG / PNG / MMD).
 * Pure string parts are unit-tested here; the filesystem/share calls are
 * thin and live at the call site so the Node vitest lane never touches
 * native modules.
 */
import { File, Paths } from "expo-file-system";
import * as Sharing from "expo-sharing";

export type ExportKind = "svg" | "png" | "mmd";

/** `data:image/png;base64,<data>` → `<data>`. `dataURL` without prefix → as-is. */
export function stripDataUrlPrefix(dataUrl: string): string {
  const comma = dataUrl.indexOf(",");
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
}

export function exportMimeType(kind: ExportKind): string {
  switch (kind) {
    case "svg":
      return "image/svg+xml";
    case "png":
      return "image/png";
    case "mmd":
      return "text/plain";
  }
}

export function exportFilename(kind: ExportKind, stamp?: number): string {
  const ts = stamp ?? Date.now();
  return kind === "mmd" ? `mermaid-${ts}.mmd` : `mermaid-${ts}.${kind}`;
}

/**
 * Write text content (UTF-8) to the cache dir and open the system share
 * sheet. Throws on failure — the caller owns the Alert/toast.
 */
export async function shareExportText(
  filename: string,
  content: string,
  mimeType: string,
): Promise<void> {
  const file = new File(Paths.cache, filename);
  file.write(content);
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType });
  }
}

/**
 * Write a `data:` URL (base64 payload) to the cache dir and open the share
 * sheet. PNG exports arrive as `data:image/png;base64,…` from the viewer
 * WebView.
 */
export async function shareExportDataUrl(
  filename: string,
  dataUrl: string,
  mimeType: string,
): Promise<void> {
  const file = new File(Paths.cache, filename);
  file.write(stripDataUrlPrefix(dataUrl), { encoding: "base64" });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, { mimeType });
  }
}