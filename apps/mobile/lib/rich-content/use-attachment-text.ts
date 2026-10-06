/**
 * Body loader for the text-backed attachment kinds (markdown / html / text).
 *
 * All three read through the same `GET /api/attachments/{id}/content` proxy —
 * a 2 MB capped, content-type whitelisted read that returns the file as text
 * (server replies `text/plain; charset=utf-8` regardless of the real type; the
 * real MIME rides in `X-Original-Content-Type`).
 *
 * The state machine is deliberately three-valued rather than a boolean pair:
 * `loading` is not `failed`. Rendering the failure copy before the first
 * response settles claims an absence out of an unsettled read — the defect
 * 198 fixed on the HTML card, so it is fixed the same way here rather than
 * re-introduced in two new renderers.
 *
 * 413 / 415 are terminal: retrying re-sends the same bytes to the same
 * whitelist and fails identically, so the UI must not offer a retry for them.
 * A transport failure is retryable.
 */
import { useCallback, useEffect, useState } from "react";
import {
  api,
  PreviewTooLargeError,
  PreviewUnsupportedError,
} from "@/data/api";

export type AttachmentTextState =
  | { status: "loading" }
  | { status: "ready"; text: string }
  | { status: "failed"; reason: "tooLarge" | "unsupported" | "failed" };

export interface AttachmentTextResult {
  state: AttachmentTextState;
  /** Re-run the read. Only meaningful for the retryable failure. */
  retry: () => void;
}

/** Fetch an attachment body as text. `attachmentId` is the ID-keyed proxy's
 *  only input; the filename/content-type play no part in this read. */
export function useAttachmentText(attachmentId: string): AttachmentTextResult {
  const [state, setState] = useState<AttachmentTextState>({ status: "loading" });

  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const res = await api.getAttachmentTextContent(attachmentId);
      setState({ status: "ready", text: res.text });
    } catch (err) {
      if (err instanceof PreviewTooLargeError) {
        setState({ status: "failed", reason: "tooLarge" });
      } else if (err instanceof PreviewUnsupportedError) {
        setState({ status: "failed", reason: "unsupported" });
      } else {
        setState({ status: "failed", reason: "failed" });
      }
    }
  }, [attachmentId]);

  useEffect(() => {
    void load();
  }, [load]);

  return { state, retry: () => void load() };
}

/** i18n key suffix for a terminal/retryable failure reason. Shared by every
 *  text-backed renderer so one reason never renders two different sentences. */
export function textFailureKey(reason: "tooLarge" | "unsupported" | "failed"): string {
  if (reason === "tooLarge") return "richContent.attachment.tooLarge";
  if (reason === "unsupported") return "richContent.attachment.unsupported";
  return "richContent.attachment.loadFailed";
}
