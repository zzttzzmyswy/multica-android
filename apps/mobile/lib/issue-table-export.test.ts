/**
 * Pure CSV export + cell-text helpers for the table view (MYS-440).
 * Serialization mirrors web's table-view export; the escaping invariants
 * (formula-injection guard + quote doubling + BOM/CRLF) are the critical
 * safety surface and are covered here.
 */
import { describe, expect, it } from "vitest";
import type { Issue, IssueProperty } from "@multica/core/types";
import {
  buildIssuesCsv,
  csvExportFileName,
  escapeCsvCell,
  exportHeaderLabels,
  tableCellText,
  type IssueTableExportContext,
} from "./issue-table-export";

const PROP_DEFS: IssueProperty[] = [
  {
    id: "def-select",
    workspace_id: "ws",
    name: "Region",
    type: "select",
    config: {
      options: [
        { id: "opt-eu", name: "EU", color: "#3b82f6" },
        { id: "opt-us", name: "US", color: "#ef4444" },
      ],
    },
    position: 0,
    archived: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: "def-ms",
    workspace_id: "ws",
    name: "Stack",
    type: "multi_select",
    config: {
      options: [
        { id: "opt-ts", name: "TS", color: "#22c55e" },
        { id: "opt-go", name: "Go", color: "#f97316" },
      ],
    },
    position: 1,
    archived: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: "def-num",
    workspace_id: "ws",
    name: "Estimate",
    type: "number",
    config: {},
    position: 2,
    archived: false,
    created_at: "",
    updated_at: "",
  },
  {
    id: "def-chk",
    workspace_id: "ws",
    name: "Shipped",
    type: "checkbox",
    config: {},
    position: 3,
    archived: false,
    created_at: "",
    updated_at: "",
  },
];

const ctx: IssueTableExportContext = {
  statusLabels: { todo: "To do", done: "Done" },
  priorityLabels: { high: "High", none: "None" },
  actorName: (type, id) =>
    type === "member" ? `Member ${id}` : type === "agent" ? `Agent ${id}` : `Squad ${id}`,
  projectTitle: (id) => (id === "prj-1" ? "Multica" : ""),
  propertyDefinitions: PROP_DEFS,
};

function makeIssue(partial: Partial<Issue> = {}): Issue {
  return {
    id: "iss-1",
    workspace_id: "ws",
    number: 1,
    identifier: "MYS-1",
    title: "Build table",
    description: null,
    status: "todo",
    priority: "high",
    assignee_type: "member",
    assignee_id: "m1",
    creator_type: "agent",
    creator_id: "a1",
    parent_issue_id: null,
    project_id: "prj-1",
    position: 0,
    stage: null,
    start_date: "2026-08-01",
    due_date: "2026-08-15",
    metadata: {},
    properties: {
      "def-select": "opt-eu",
      "def-ms": ["opt-ts", "opt-go"],
      "def-num": 5,
      "def-chk": true,
    },
    labels: [
      {
        id: "l1",
        name: "frontend",
        color: "#6366f1",
        workspace_id: "ws",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
      {
        id: "l2",
        name: "mobile",
        color: "#14b8a6",
        workspace_id: "ws",
        created_at: "2026-08-01T00:00:00Z",
        updated_at: "2026-08-01T00:00:00Z",
      },
    ],
    created_at: "2026-08-01T00:00:00Z",
    updated_at: "2026-08-02T00:00:00Z",
    ...partial,
  };
}

describe("tableCellText", () => {
  const issue = makeIssue();

  it("reads raw string fields straight off the issue", () => {
    expect(tableCellText(issue, "title", ctx)).toBe("Build table");
    expect(tableCellText(issue, "identifier", ctx)).toBe("MYS-1");
    expect(tableCellText(issue, "start_date", ctx)).toBe("2026-08-01");
    expect(tableCellText(issue, "due_date", ctx)).toBe("2026-08-15");
    expect(tableCellText(issue, "created_at", ctx)).toBe("2026-08-01T00:00:00Z");
    expect(tableCellText(issue, "updated_at", ctx)).toBe("2026-08-02T00:00:00Z");
  });

  it("localizes status and priority", () => {
    expect(tableCellText(issue, "status", ctx)).toBe("To do");
    expect(tableCellText(issue, "priority", ctx)).toBe("High");
  });

  it("resolves assignee via the actor catalog and empties on unassigned", () => {
    expect(tableCellText(issue, "assignee", ctx)).toBe("Member m1");
    expect(tableCellText(makeIssue({ assignee_type: null, assignee_id: null }), "assignee", ctx)).toBe("");
    expect(tableCellText(issue, "creator", ctx)).toBe("Agent a1");
  });

  it("joins labels with ', ' and resolves the project title", () => {
    expect(tableCellText(issue, "labels", ctx)).toBe("frontend, mobile");
    expect(tableCellText(issue, "project", ctx)).toBe("Multica");
    expect(tableCellText(makeIssue({ project_id: null }), "project", ctx)).toBe("");
  });

  it("resolves property columns per type", () => {
    expect(tableCellText(issue, "property:def-select", ctx)).toBe("EU");
    expect(tableCellText(issue, "property:def-ms", ctx)).toBe("TS, Go");
    expect(tableCellText(issue, "property:def-num", ctx)).toBe("5");
    expect(tableCellText(issue, "property:def-chk", ctx)).toBe("true");
  });

  it("returns '' for a missing definition or vanished option ids", () => {
    expect(tableCellText(issue, "property:def-gone", ctx)).toBe("");
    const noOptions = makeIssue({ properties: { "def-select": "opt-zz" } });
    expect(tableCellText(noOptions, "property:def-select", ctx)).toBe("");
    expect(tableCellText(makeIssue({ due_date: null }), "due_date", ctx)).toBe("");
  });
});

describe("escapeCsvCell", () => {
  it("defuses formula-injection prefixes while preserving numbers", () => {
    expect(escapeCsvCell("=SUM(A1:A2)")).toBe("'=SUM(A1:A2)");
    expect(escapeCsvCell("+cmd|' /C calc'")).toBe("'+cmd|' /C calc'");
    expect(escapeCsvCell("@import x")).toBe("'@import x");
    expect(escapeCsvCell("-1 + 2")).toBe("'-1 + 2");
    expect(escapeCsvCell("42")).toBe("42");
    expect(escapeCsvCell("3.14")).toBe("3.14");
  });

  it("quotes cells containing commas, quotes or newlines with doubled quotes", () => {
    expect(escapeCsvCell("a,b")).toBe('"a,b"');
    expect(escapeCsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCsvCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCsvCell("plain")).toBe("plain");
  });
});

describe("buildIssuesCsv", () => {
  const columns = ["title", "status", "property:def-select"] as const;
  const header = ["Title", "Status", "Region"];

  it("writes a BOM + header row + one row per issue, CRLF-separated", () => {
    const csv = buildIssuesCsv(
      [makeIssue(), makeIssue({ title: "Esc, \"2\"", status: "done" })],
      columns,
      header,
      (issue, column) => tableCellText(issue, column, ctx),
    );
    const lines = csv.slice(1).split("\r\n");
    expect(csv.startsWith("﻿")).toBe(true);
    expect(lines).toEqual([
      "Title,Status,Region",
      "Build table,To do,EU",
      '"Esc, ""2""",Done,EU',
    ]);
  });
});

describe("export header + filename", () => {
  it("maps header labels through the caller's resolver", () => {
    expect(exportHeaderLabels(["title", "status"], (c) => (c === "title" ? "Title" : "Status"))).toEqual([
      "Title",
      "Status",
    ]);
  });

  it("builds web-style filenames", () => {
    expect(csvExportFileName("all", "2026-08-18")).toBe("issues-2026-08-18.csv");
    expect(csvExportFileName("selected", "2026-08-18")).toBe("issues-selected-2026-08-18.csv");
  });
});
