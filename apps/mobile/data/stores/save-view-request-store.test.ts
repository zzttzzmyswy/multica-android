/**
 * Guards for the cross-component save-view request channel (iteration 263).
 *
 * The chip bar cannot reach the saved-views bar's dialog state, and lifting the
 * dialog into all three host screens would mean three copies of the same
 * create/update payload. `save-view-request-store.ts` is the channel: the chip
 * bar raises a per-container token, the bar consumes it.
 *
 * The store is small, but the property it exists for is not: a boolean flag
 * would have to be cleared by the consumer, and "consume then clear" races with
 * re-renders — two quick taps collapse into one open, and a clear landing after
 * the next raise swallows it silently. The cases below pin the counter
 * behaviour that makes the consumer's check a plain inequality.
 */
import { beforeEach, describe, expect, it } from "vitest";
import {
  requestSaveView,
  saveViewRequestToken,
  useSaveViewRequestStore,
} from "@/data/stores/save-view-request-store";

const KEY_A = "ws-1:workspace:null";
const KEY_B = "ws-1:my:null";

beforeEach(() => {
  // The store is module-level, so each case starts from a known empty doc.
  useSaveViewRequestStore.setState({ tokens: {} });
});

describe("saveViewRequestToken", () => {
  it("starts at zero for a container nobody has asked about", () => {
    expect(saveViewRequestToken(KEY_A)).toBe(0);
  });

  it("counts up on every request", () => {
    requestSaveView(KEY_A);
    expect(saveViewRequestToken(KEY_A)).toBe(1);
    requestSaveView(KEY_A);
    expect(saveViewRequestToken(KEY_A)).toBe(2);
  });

  it("gives two quick taps two distinct tokens", () => {
    // The reason this is a counter and not a flag: one open must not be able
    // to swallow the second tap. A consumer that saw 0 → 1 and then 1 → 2
    // opens twice, which is what the user asked for.
    requestSaveView(KEY_A);
    const first = saveViewRequestToken(KEY_A);
    requestSaveView(KEY_A);
    const second = saveViewRequestToken(KEY_A);
    expect(second).toBeGreaterThan(first);
  });

  it("keeps containers independent", () => {
    // The workspace Issues page, My Issues and each project each own a
    // container. A shared counter would make a tap on one surface open the
    // dialog on another — the same cross-talk the active-view store's
    // per-container key exists to prevent.
    requestSaveView(KEY_A);
    expect(saveViewRequestToken(KEY_A)).toBe(1);
    expect(saveViewRequestToken(KEY_B)).toBe(0);
    requestSaveView(KEY_B);
    expect(saveViewRequestToken(KEY_A)).toBe(1);
    expect(saveViewRequestToken(KEY_B)).toBe(1);
  });

  it("leaves the other containers' tokens untouched when one advances", () => {
    requestSaveView(KEY_B);
    const before = { ...useSaveViewRequestStore.getState().tokens };
    requestSaveView(KEY_A);
    const after = useSaveViewRequestStore.getState().tokens;
    expect(after[KEY_B]).toBe(before[KEY_B]);
  });
});
