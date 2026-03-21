"use client";

import { useState } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  ArrowRightLeft,
} from "lucide-react";
import type { InboxItem, InboxItemType, InboxSeverity } from "@multica/types";

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_INBOX_ITEMS: InboxItem[] = [
  {
    id: "inb_1",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "agent_blocked",
    severity: "action_required",
    issue_id: "iss_12",
    title: "Agent Claude-1 is blocked on MUL-12",
    body: "I need clarification on the authentication flow. The current OAuth implementation uses PKCE, but the design doc references a session-based approach. Which one should I follow?\n\nSpecifically:\n1. Should we keep the PKCE flow for the SPA?\n2. Is the session cookie approach only for the server-rendered pages?\n3. Should I implement both and let the client decide?\n\nBlocked on this decision before I can continue with the login page implementation.",
    read: false,
    archived: false,
    created_at: "2026-03-21T05:32:00Z",
  },
  {
    id: "inb_2",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "review_requested",
    severity: "action_required",
    issue_id: "iss_8",
    title: "PR #47: Add WebSocket reconnection logic",
    body: "Agent Codex-1 has submitted a pull request for review.\n\n**Changes:**\n- Added exponential backoff for WebSocket reconnection\n- Max retry attempts configurable via env var\n- Added connection state to the store\n- Unit tests for reconnection logic\n\n**Files changed:** 6 files (+284, -12)\n\nThe agent notes that it chose exponential backoff over linear retry because of the bursty reconnection pattern observed in the daemon logs.",
    read: false,
    archived: false,
    created_at: "2026-03-21T04:15:00Z",
  },
  {
    id: "inb_3",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "issue_assigned",
    severity: "action_required",
    issue_id: "iss_15",
    title: "New issue assigned: Design the agent config UI",
    body: "You've been assigned to MUL-15: Design the agent config UI.\n\nPriority: High\nCreated by: Bohan\n\nDescription:\nWe need a configuration panel where users can set up their local agents — select runtime type, set concurrency limits, and manage API keys. This should live in the Settings page for now.",
    read: true,
    archived: false,
    created_at: "2026-03-21T02:40:00Z",
  },
  {
    id: "inb_4",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "agent_completed",
    severity: "attention",
    issue_id: "iss_6",
    title: "Agent Claude-1 completed MUL-6: API error handling",
    body: "The task has been completed and all acceptance criteria passed:\n\n✅ Standardized error response format\n✅ Added error codes enum\n✅ Middleware catches panics and returns 500\n✅ All existing tests still pass\n✅ 4 new test cases added\n\nPR #45 has been created and CI is green. Ready for your review when convenient.",
    read: false,
    archived: false,
    created_at: "2026-03-20T22:10:00Z",
  },
  {
    id: "inb_5",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "mentioned",
    severity: "attention",
    issue_id: "iss_10",
    title: "Yuzhen mentioned you in MUL-10",
    body: "@jiayuan Can you take a look at the database schema for the knowledge base? I want to make sure the vector embeddings table is set up correctly before we start indexing.\n\nI'm thinking we should use pgvector with HNSW index for the similarity search. Thoughts?",
    read: true,
    archived: false,
    created_at: "2026-03-20T18:30:00Z",
  },
  {
    id: "inb_6",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "status_change",
    severity: "info",
    issue_id: "iss_3",
    title: "MUL-3 moved to Done",
    body: "Issue \"Set up CI/CD pipeline\" has been moved from In Review to Done by Bohan.\n\nThe GitHub Actions workflow is now running on every push to main. Build, test, and lint checks are all configured.",
    read: true,
    archived: false,
    created_at: "2026-03-20T15:00:00Z",
  },
  {
    id: "inb_7",
    workspace_id: "ws_1",
    recipient_type: "member",
    recipient_id: "usr_1",
    type: "status_change",
    severity: "info",
    issue_id: "iss_9",
    title: "MUL-9 moved to In Progress",
    body: "Agent Codex-1 has started working on \"Implement issue list API endpoint\".\n\nEstimated approach:\n1. Add sqlc queries for listing/filtering issues\n2. Implement Chi handler with pagination\n3. Add sorting by priority, status, created_at\n4. Write integration tests",
    read: true,
    archived: false,
    created_at: "2026-03-20T12:45:00Z",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const severityOrder: Record<InboxSeverity, number> = {
  action_required: 0,
  attention: 1,
  info: 2,
};

const typeIcons: Record<InboxItemType, typeof AlertCircle> = {
  agent_blocked: AlertCircle,
  review_requested: GitPullRequest,
  issue_assigned: CircleDot,
  agent_completed: CheckCircle2,
  mentioned: MessageSquare,
  status_change: ArrowRightLeft,
};

const severityColors: Record<InboxSeverity, string> = {
  action_required: "text-red-500",
  attention: "text-yellow-500",
  info: "text-muted-foreground",
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function InboxListItem({
  item,
  isSelected,
  onClick,
}: {
  item: InboxItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const Icon = typeIcons[item.type];
  const colorClass = severityColors[item.severity];

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors ${
        isSelected
          ? "bg-accent"
          : "hover:bg-accent/50"
      } ${!item.read ? "font-medium" : ""}`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${colorClass}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm">{item.title}</span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {timeAgo(item.created_at)}
          </span>
        </div>
        {item.type === "agent_blocked" || item.type === "review_requested" ? (
          <div className="mt-0.5 flex items-center gap-1.5">
            <Bot className="h-3 w-3 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Agent action</span>
          </div>
        ) : null}
      </div>
      {!item.read && (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
      )}
    </button>
  );
}

function InboxDetail({ item }: { item: InboxItem }) {
  const Icon = typeIcons[item.type];
  const colorClass = severityColors[item.severity];

  const severityLabel: Record<InboxSeverity, string> = {
    action_required: "Action required",
    attention: "Needs attention",
    info: "Info",
  };

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex items-start gap-3">
        <Icon className={`mt-1 h-5 w-5 shrink-0 ${colorClass}`} />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{item.title}</h2>
          <div className="mt-1 flex items-center gap-3 text-sm text-muted-foreground">
            <span className={colorClass}>{severityLabel[item.severity]}</span>
            <span>·</span>
            <span>{timeAgo(item.created_at)}</span>
            {item.issue_id && (
              <>
                <span>·</span>
                <span>{item.issue_id}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {item.body && (
        <div className="mt-6 whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
          {item.body}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function InboxPage() {
  const sorted = [...MOCK_INBOX_ITEMS].sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  );

  const [selectedId, setSelectedId] = useState<string>(sorted[0]?.id ?? "");
  const selected = sorted.find((i) => i.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      {/* Left column — inbox list */}
      <div className="w-80 shrink-0 overflow-y-auto border-r">
        <div className="flex h-12 items-center border-b px-4">
          <h1 className="text-sm font-semibold">Inbox</h1>
          <span className="ml-2 rounded-full bg-primary px-2 py-0.5 text-xs text-primary-foreground">
            {sorted.filter((i) => !i.read).length}
          </span>
        </div>
        <div className="divide-y">
          {sorted.map((item) => (
            <InboxListItem
              key={item.id}
              item={item}
              isSelected={item.id === selectedId}
              onClick={() => setSelectedId(item.id)}
            />
          ))}
        </div>
      </div>

      {/* Right column — detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <InboxDetail item={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an item to view details
          </div>
        )}
      </div>
    </div>
  );
}
