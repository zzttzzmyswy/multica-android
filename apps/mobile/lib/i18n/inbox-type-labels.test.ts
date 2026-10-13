/**
 * Every inbox notification type the app knows about must have a label in both
 * locales.
 *
 * Found on the Pixel 5 in iteration 238 (v0.6.72): the archived view rendered
 * the literal string `inbox.type.autopilot_paused` where a notification type
 * belongs. Two gaps compounded —
 *
 *   1. `InboxItemType` (packages/core/types/inbox.ts) listed neither
 *      `autopilot_paused`, `autopilot_quota_exceeded` nor `children_done`,
 *      although all three are on the wire (the first two observed live);
 *   2. the locale files had no `inbox.type.*` keys for them either, so
 *      `typeLabel` — which is `t(\`inbox.type.${type}\`)` — returned its own
 *      input.
 *
 * Neither gap was reachable before this iteration for one reason: these types
 * are ISSUE-LESS, and the archived view was the only surface that could not
 * reach them (the capped endpoint, the main inbox's dedup, and the archive's
 * own truncation all kept them out of sight). Making the archive complete is
 * what surfaced it, which is exactly when a missing label stops being
 * theoretical.
 *
 * The keys are pinned to the union rather than to a hand-written list, so
 * adding a type without its labels fails here instead of shipping a raw id.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const TYPES_SOURCE = path.resolve(
  __dirname,
  "../../../../packages/core/types/inbox.ts",
);

function loadBundle(locale: "en" | "zh"): Record<string, string> {
  return JSON.parse(
    readFileSync(path.resolve(__dirname, `locales/${locale}.json`), "utf-8"),
  );
}

/** The members of `InboxItemType`, read off the union itself. */
function inboxItemTypes(): string[] {
  const source = readFileSync(TYPES_SOURCE, "utf-8");
  const union = /export type InboxItemType =([\s\S]*?);/.exec(source);
  if (!union) throw new Error("InboxItemType union not found");
  return [...union[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
}

describe("inbox notification type labels", () => {
  it("finds the union (guards against a silently empty test)", () => {
    expect(inboxItemTypes().length).toBeGreaterThan(15);
  });

  it("labels every type in both locales", () => {
    const en = loadBundle("en");
    const zh = loadBundle("zh");
    for (const type of inboxItemTypes()) {
      const key = `inbox.type.${type}`;
      expect(en[key], `en ${key}`).toBeTruthy();
      // A zh value equal to the KEY is how an unresolved lookup renders; a zh
      // value equal to the ENGLISH text means the entry was copied and never
      // translated, which is the same bug in a different costume.
      expect(zh[key], `zh ${key}`).toBeTruthy();
      expect(zh[key], `zh ${key}`).not.toBe(key);
      expect(zh[key], `zh ${key}`).not.toBe(en[key]);
    }
  });

  it("labels the three types the archived view surfaced", () => {
    // Named explicitly because these are the regression: they rendered as raw
    // keys on the device. Asserting them by name keeps the failure message
    // useful if the union is ever rewritten wholesale.
    const en = loadBundle("en");
    expect(en["inbox.type.autopilot_paused"]).toBe("Autopilot paused");
    expect(en["inbox.type.autopilot_quota_exceeded"]).toBe(
      "Autopilot run limit reached",
    );
    expect(en["inbox.type.children_done"]).toBe("Sub-issues finished");
  });

  it("keeps the two locale bundles at key parity for inbox.type.*", () => {
    const en = loadBundle("en");
    const zh = loadBundle("zh");
    const enKeys = Object.keys(en).filter((k) => k.startsWith("inbox.type."));
    const zhKeys = Object.keys(zh).filter((k) => k.startsWith("inbox.type."));
    expect(zhKeys.sort()).toEqual(enKeys.sort());
  });
});
