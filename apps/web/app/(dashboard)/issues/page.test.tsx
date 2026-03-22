import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Issue, ListIssuesResponse } from "@multica/types";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => "/issues",
}));

// Mock next/link
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    ...props
  }: {
    children: React.ReactNode;
    href: string;
    [key: string]: any;
  }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock auth context
vi.mock("../../../lib/auth-context", () => ({
  useAuth: () => ({
    user: { id: "user-1", name: "Test User", email: "test@multica.ai" },
    workspace: { id: "ws-1", name: "Test WS" },
    members: [
      { user_id: "user-1", name: "Test User", email: "test@multica.ai" },
    ],
    agents: [{ id: "agent-1", name: "Claude Agent" }],
    isLoading: false,
    getActorName: (type: string, id: string) =>
      type === "member" ? "Test User" : "Claude Agent",
    getActorInitials: () => "TU",
  }),
}));

// Mock WebSocket context
vi.mock("../../../lib/ws-context", () => ({
  useWSEvent: vi.fn(),
  useWS: () => ({ subscribe: vi.fn(() => () => {}) }),
  WSProvider: ({ children }: { children: React.ReactNode }) => children,
}));

// Mock api
const mockListIssues = vi.fn();
const mockCreateIssue = vi.fn();
const mockUpdateIssue = vi.fn();

vi.mock("../../../lib/api", () => ({
  api: {
    listIssues: (...args: any[]) => mockListIssues(...args),
    createIssue: (...args: any[]) => mockCreateIssue(...args),
    updateIssue: (...args: any[]) => mockUpdateIssue(...args),
  },
}));

const issueDefaults = {
  parent_issue_id: null,
  acceptance_criteria: [],
  context_refs: [],
  repository: null,
  position: 0,
};

const mockIssues: Issue[] = [
  {
    ...issueDefaults,
    id: "issue-1",
    workspace_id: "ws-1",
    title: "Implement auth",
    description: "Add JWT authentication",
    status: "todo",
    priority: "high",
    assignee_type: "member",
    assignee_id: "user-1",
    creator_type: "member",
    creator_id: "user-1",
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    ...issueDefaults,
    id: "issue-2",
    workspace_id: "ws-1",
    title: "Design landing page",
    description: null,
    status: "in_progress",
    priority: "medium",
    assignee_type: "agent",
    assignee_id: "agent-1",
    creator_type: "member",
    creator_id: "user-1",
    due_date: "2026-02-01T00:00:00Z",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
  {
    ...issueDefaults,
    id: "issue-3",
    workspace_id: "ws-1",
    title: "Write tests",
    description: null,
    status: "backlog",
    priority: "low",
    assignee_type: null,
    assignee_id: null,
    creator_type: "member",
    creator_id: "user-1",
    due_date: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
  },
];

import IssuesPage from "./page";

describe("IssuesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    mockListIssues.mockReturnValueOnce(new Promise(() => {}));
    render(<IssuesPage />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders issues in board view after loading", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: mockIssues,
      total: 3,
    } as ListIssuesResponse);

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Implement auth")).toBeInTheDocument();
    });

    expect(screen.getByText("Design landing page")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();
    expect(screen.getByText("All Issues")).toBeInTheDocument();
  });

  it("renders board columns", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: mockIssues,
      total: 3,
    } as ListIssuesResponse);

    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Backlog")).toBeInTheDocument();
    });

    expect(screen.getByText("Todo")).toBeInTheDocument();
    expect(screen.getByText("In Progress")).toBeInTheDocument();
    expect(screen.getByText("In Review")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
  });

  it("switches to list view", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: mockIssues,
      total: 3,
    } as ListIssuesResponse);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("Implement auth")).toBeInTheDocument();
    });

    // Find the List button and click it
    const listButton = screen.getByText("List");
    await user.click(listButton);

    // Issues should still be visible
    expect(screen.getByText("Implement auth")).toBeInTheDocument();
    expect(screen.getByText("Design landing page")).toBeInTheDocument();
  });

  it("shows 'New Issue' button and opens create form", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [],
      total: 0,
    } as ListIssuesResponse);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("New Issue")).toBeInTheDocument();
    });

    await user.click(screen.getByText("New Issue"));

    // Create form should be visible
    expect(
      screen.getByPlaceholderText("Issue title..."),
    ).toBeInTheDocument();
    expect(screen.getByText("Create")).toBeInTheDocument();
    expect(screen.getByText("Cancel")).toBeInTheDocument();
  });

  it("creates an issue via the form", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [],
      total: 0,
    } as ListIssuesResponse);

    const newIssue: Issue = {
      ...issueDefaults,
      id: "issue-new",
      workspace_id: "ws-1",
      title: "New test issue",
      description: null,
      status: "backlog",
      priority: "none",
      assignee_type: null,
      assignee_id: null,
      creator_type: "member",
      creator_id: "user-1",
      due_date: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-01T00:00:00Z",
    };
    mockCreateIssue.mockResolvedValueOnce(newIssue);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("New Issue")).toBeInTheDocument();
    });

    await user.click(screen.getByText("New Issue"));
    await user.type(
      screen.getByPlaceholderText("Issue title..."),
      "New test issue",
    );
    await user.click(screen.getByText("Create"));

    await waitFor(() => {
      expect(mockCreateIssue).toHaveBeenCalledWith({
        title: "New test issue",
      });
    });

    // New issue should appear
    await waitFor(() => {
      expect(screen.getByText("New test issue")).toBeInTheDocument();
    });
  });

  it("closes create form on Cancel", async () => {
    mockListIssues.mockResolvedValueOnce({
      issues: [],
      total: 0,
    } as ListIssuesResponse);

    const user = userEvent.setup();
    render(<IssuesPage />);

    await waitFor(() => {
      expect(screen.getByText("New Issue")).toBeInTheDocument();
    });

    await user.click(screen.getByText("New Issue"));
    expect(
      screen.getByPlaceholderText("Issue title..."),
    ).toBeInTheDocument();

    await user.click(screen.getByText("Cancel"));
    expect(
      screen.queryByPlaceholderText("Issue title..."),
    ).not.toBeInTheDocument();
    expect(screen.getByText("New Issue")).toBeInTheDocument();
  });

  it("handles API error gracefully", async () => {
    mockListIssues.mockRejectedValueOnce(new Error("Network error"));

    render(<IssuesPage />);

    // Should finish loading without crashing
    await waitFor(() => {
      expect(screen.queryByText("Loading...")).not.toBeInTheDocument();
    });
  });
});
