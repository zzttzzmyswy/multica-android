import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

// Outcome -> honest sentence mapping for the issue-detail Quick Actions
// section (MYS-680). Same contract as web's `outcomeMessage`
// (packages/views/issues/components/quick-actions-section.tsx:136) — six
// branches tested against the REAL localized copy so a translation drift
// fails the test, not just for the user later.
import { quickActionOutcomeMessage } from "./quick-action-outcome";
import * as i18n from "./i18n";

describe("quickActionOutcomeMessage", () => {
  beforeEach(() => {
    i18n.resetI18nForTests();
    i18n.setLocale("en");
  });

  const en = (id: string, params?: Record<string, string | number>) =>
    i18n.translate(id, params);

  it("treats a missing outcome as posted (neutral, no claimed run)", () => {
    expect(quickActionOutcomeMessage(undefined, "X", en)).toEqual({
      message: "Comment posted",
      kind: "info",
    });
  });

  it("queued → success with the target name interpolated", () => {
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "queued", reason_code: "" },
        "Code Review Agent",
        en,
      ),
    ).toEqual({ message: "Code Review Agent started working", kind: "success" });
  });

  it("coalesced → info, honestly saying it merged into an existing run", () => {
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "coalesced", reason_code: "" },
        "Lambda",
        en,
      ),
    ).toEqual({ message: "Added to Lambda’s current run", kind: "info" });
  });

  it("deferred → info (target offline, will start later)", () => {
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "deferred", reason_code: "" },
        "Night",
        en,
      ),
    ).toEqual({
      message: "Night is offline — it will start once back online",
      kind: "info",
    });
  });

  it("blocked → error, not a silent success", () => {
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "blocked", reason_code: "invocation_not_allowed" },
        "Locker",
        en,
      ),
    ).toEqual({ message: "Locker could not be triggered", kind: "error" });
  });

  it("never claims success for an unknown server-driven status", () => {
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "brand_new_status", reason_code: "" },
        "X",
        en,
      ),
    ).toEqual({ message: "Comment posted", kind: "info" });
  });

  it("localizes the same branches in zh", () => {
    i18n.setLocale("zh");
    const zh = (id: string, params?: Record<string, string | number>) =>
      i18n.translate(id, params);
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "queued", reason_code: "" },
        "审查 Agent",
        zh,
      ),
    ).toEqual({ message: "审查 Agent 已开始处理", kind: "success" });
    expect(
      quickActionOutcomeMessage(
        { target_type: "agent", target_id: "t", status: "coalesced", reason_code: "" },
        "Lambda",
        zh,
      ),
    ).toEqual({ message: "已加入 Lambda 当前的 task", kind: "info" });
  });
});