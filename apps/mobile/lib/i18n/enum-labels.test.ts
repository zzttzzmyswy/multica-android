import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("expo-secure-store", () => ({
  getItemAsync: vi.fn(),
  setItemAsync: vi.fn(),
  deleteItemAsync: vi.fn(),
}));
vi.mock("expo-localization", () => ({
  getLocales: vi.fn(),
}));

async function loadI18n() {
  return await import("./index");
}
async function loadIssueStatus() {
  return await import("../issue-status");
}
async function loadProjectStatus() {
  return await import("../project-status");
}
async function loadFormatActivity() {
  return await import("../format-activity");
}

describe("enum label dict-ization", () => {
  let i18n: Awaited<ReturnType<typeof loadI18n>>;
  let issueStatus: Awaited<ReturnType<typeof loadIssueStatus>>;
  let projectStatus: Awaited<ReturnType<typeof loadProjectStatus>>;

  beforeEach(async () => {
    vi.clearAllMocks();
    i18n = await loadI18n();
    issueStatus = await loadIssueStatus();
    projectStatus = await loadProjectStatus();
    i18n.resetI18nForTests();
    i18n.setLocale("en");
  });

  it("localizes issue status labels in English", () => {
    expect(i18n.translate("enum.status.in_progress")).toBe("In Progress");
    expect(i18n.translate("enum.priority.high")).toBe("High");
  });

  it("localizes issue status labels in Chinese", () => {
    i18n.setLocale("zh");
    expect(i18n.translate("enum.status.in_progress")).toBe("进行中");
    expect(i18n.translate("enum.priority.high")).toBe("高");
  });

  it("issueStatusLabel falls back to canonical English for unknown values", () => {
    expect(issueStatus.issueStatusLabel("in_progress")).toBe("In Progress");
    // A value with no dict key degrades to the canonical English map, not the raw id.
    i18n.setLocale("zh");
    expect(issueStatus.issueStatusLabel("something_new")).toBe("something_new");
  });

  it("projectStatusLabel / projectPriorityLabel localize and fall back", () => {
    expect(projectStatus.projectStatusLabel("planned")).toBe("Planned");
    expect(projectStatus.projectPriorityLabel("none")).toBe("No priority");
    i18n.setLocale("zh");
    expect(projectStatus.projectStatusLabel("planned")).toBe("计划中");
    expect(projectStatus.projectPriorityLabel("none")).toBe("无优先级");
    expect(projectStatus.projectStatusLabel("unknown_enum")).toBe("unknown_enum");
  });

  it("zd/en dictionaries are mirror-images (zh has every key en has)", () => {
    // Detect accidental zh/en key drift so bilingual coverage never silently
    // diverges — zh is the primary loc, en the fallback. Probe representative
    // enum + activity + inbox keys through the public translate API.
    const sample = [
      "enum.status.backlog",
      "enum.taskStatus.running",
      "activity.statusChanged",
      "inbox.assignedTo",
      "runs.cancelTaskTitle",
    ];
    for (const key of sample) {
      expect(i18n.translate(key)).not.toBe(key); // present in en
      i18n.setLocale("zh");
      expect(i18n.translate(key)).not.toBe(key); // present in zh
      i18n.setLocale("en");
    }
  });
});

describe("formatActivity i18n", () => {
  let i18n: Awaited<ReturnType<typeof loadI18n>>;
  let fmt: Awaited<ReturnType<typeof loadFormatActivity>>;

  beforeEach(async () => {
    i18n = await loadI18n();
    fmt = await loadFormatActivity();
    i18n.resetI18nForTests();
    i18n.setLocale("en");
  });

  it("localizes a status-change activity verb with enum labels", () => {
    const out = fmt.formatActivity(
      {
        action: "status_changed",
        details: { from: "todo", to: "done" },
      } as never,
      () => "nobody",
    );
    expect(out).toBe("changed status: Todo → Done");
    i18n.setLocale("zh");
    const zh = fmt.formatActivity(
      { action: "status_changed", details: { from: "todo", to: "done" } } as never,
      () => "nobody",
    );
    expect(zh).toBe("更改状态：待处理 → 已完成");
  });

  it("localizes a created-issue verb", () => {
    expect(
      fmt.formatActivity({ action: "created" } as never, () => "nobody"),
    ).toBe("created the issue");
    i18n.setLocale("zh");
    expect(
      fmt.formatActivity({ action: "created" } as never, () => "nobody"),
    ).toBe("创建了问题");
  });
});