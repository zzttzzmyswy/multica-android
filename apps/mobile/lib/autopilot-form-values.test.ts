import { describe, expect, it } from "vitest";
import {
  buildCreateAutopilotRequest,
  buildUpdateAutopilotRequest,
  resolvedProjectId,
  serializedDescription,
  type AutopilotFormValues,
} from "./autopilot-form-values";

const BASE: AutopilotFormValues = {
  title: "  Daily digest  ",
  description: "  What should the agent do?  ",
  projectId: "proj-1",
  assigneeType: "agent",
  assigneeId: "agent-9",
  executionMode: "create_issue",
  subscriberUserIds: ["member-1", "member-2"],
};

describe("resolvedProjectId", () => {
  it("keeps the project id in create_issue mode", () => {
    expect(resolvedProjectId("create_issue", "proj-1")).toBe("proj-1");
    expect(resolvedProjectId("create_issue", null)).toBeNull();
  });

  it("drops the project id in run_only mode (web dialog parity)", () => {
    expect(resolvedProjectId("run_only", "proj-1")).toBeNull();
  });
});

describe("serializedDescription", () => {
  it("maps blank to undefined for create, null for edit", () => {
    expect(serializedDescription("create", "   ")).toBeUndefined();
    expect(serializedDescription("edit", "   ")).toBeNull();
    expect(serializedDescription("create", "  hi ")).toBe("hi");
    expect(serializedDescription("edit", "  hi ")).toBe("hi");
  });
});

describe("buildCreateAutopilotRequest", () => {
  it("carries title/description/mode and trims whitespace", () => {
    const req = buildCreateAutopilotRequest(BASE);
    expect(req.title).toBe("Daily digest");
    expect(req.description).toBe("What should the agent do?");
    expect(req.execution_mode).toBe("create_issue");
  });

  it("maps subscriber ids into member inputs", () => {
    const req = buildCreateAutopilotRequest(BASE);
    expect(req.subscribers).toEqual([
      { user_type: "member", user_id: "member-1" },
      { user_type: "member", user_id: "member-2" },
    ]);
  });

  it("keeps assignee_type for squad selections", () => {
    const req = buildCreateAutopilotRequest({
      ...BASE,
      assigneeType: "squad",
      assigneeId: "squad-3",
    });
    expect(req.assignee_type).toBe("squad");
    expect(req.assignee_id).toBe("squad-3");
  });

  it("passes project_id in create_issue mode", () => {
    const req = buildCreateAutopilotRequest(BASE);
    expect(req.project_id).toBe("proj-1");
  });

  it("nulls project_id in run_only mode", () => {
    const req = buildCreateAutopilotRequest({
      ...BASE,
      executionMode: "run_only",
    });
    expect(req.project_id).toBeNull();
  });

  it("omits empty description for create", () => {
    const req = buildCreateAutopilotRequest({ ...BASE, description: "   " });
    expect(req.description).toBeUndefined();
  });
});

describe("buildUpdateAutopilotRequest", () => {
  it("carries the autopilot id plus every editable field", () => {
    const req = buildUpdateAutopilotRequest("auto-1", BASE);
    expect(req.id).toBe("auto-1");
    expect(req.title).toBe("Daily digest");
    expect(req.description).toBe("What should the agent do?");
    expect(req.execution_mode).toBe("create_issue");
    expect(req.project_id).toBe("proj-1");
    expect(req.assignee_type).toBe("agent");
    expect(req.assignee_id).toBe("agent-9");
    expect(req.subscribers).toEqual([
      { user_type: "member", user_id: "member-1" },
      { user_type: "member", user_id: "member-2" },
    ]);
  });

  it("nulls description when emptied (unlike create)", () => {
    const req = buildUpdateAutopilotRequest("auto-1", {
      ...BASE,
      description: "   ",
    });
    expect(req.description).toBeNull();
  });

  it("sends assignee_type together with assignee_id on a type swap", () => {
    const req = buildUpdateAutopilotRequest("auto-1", {
      ...BASE,
      assigneeType: "squad",
      assigneeId: "squad-5",
    });
    expect(req.assignee_type).toBe("squad");
    expect(req.assignee_id).toBe("squad-5");
  });

  it("nulls project_id when switching to run_only", () => {
    const req = buildUpdateAutopilotRequest("auto-1", {
      ...BASE,
      executionMode: "run_only",
    });
    expect(req.project_id).toBeNull();
  });
});
