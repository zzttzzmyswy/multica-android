import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import type { ContentBlock } from "@multica/sdk"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Extract concatenated plain text from a ContentBlock array */
export function getTextContent(blocks: ContentBlock[]): string {
  return blocks
    .filter((b): b is { type: "text"; text: string } => b.type === "text")
    .map((b) => b.text)
    .join("")
}
