/**
 * Feedback draft persistence (iteration-100) — mirrors web's
 * packages/core/feedback/draft-store.ts (localStorage key
 * `multica_feedback_draft`) with the lightest SecureStore equivalent: load on
 * page mount, save on change, clear on successful submit. Deliberately
 * dependency-free (no store/jar) because the only consumer is the single
 * Feedback page. Web writes on every editor keystroke too; SecureStore writes
 * are cheap enough here and the draft is tiny.
 */
import * as SecureStore from "expo-secure-store";

const DRAFT_KEY = "multica_feedback_draft";

export async function loadFeedbackDraft(): Promise<string> {
  try {
    const raw = await SecureStore.getItemAsync(DRAFT_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as { message?: unknown };
    return typeof parsed?.message === "string" ? parsed.message : "";
  } catch {
    return "";
  }
}

export async function saveFeedbackDraft(message: string): Promise<void> {
  try {
    if (!message.trim()) {
      await SecureStore.deleteItemAsync(DRAFT_KEY);
      return;
    }
    await SecureStore.setItemAsync(DRAFT_KEY, JSON.stringify({ message }));
  } catch {
    // Best-effort — a failing write never blocks composition or submission.
  }
}

export async function clearFeedbackDraft(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(DRAFT_KEY);
  } catch {
    // Best-effort.
  }
}