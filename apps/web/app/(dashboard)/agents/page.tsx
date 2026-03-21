"use client";

import { useState } from "react";
import {
  Bot,
  Cloud,
  Monitor,
  Plus,
  Wrench,
  Blocks,
  Zap,
  GitBranch,
  FileCode,
  MessageSquare,
  Terminal,
  Database,
  Globe,
  ListTodo,
} from "lucide-react";
import type { AgentStatus, AgentRuntimeMode } from "@multica/types";

// ---------------------------------------------------------------------------
// Types for mock data
// ---------------------------------------------------------------------------

interface AgentSkill {
  id: string;
  name: string;
  description: string;
}

interface AgentTool {
  id: string;
  name: string;
  icon: typeof Terminal;
  connected: boolean;
}

interface AgentTask {
  id: string;
  issueKey: string;
  title: string;
  status: "working" | "queued";
}

interface MockAgent {
  id: string;
  name: string;
  avatar: string;
  runtimeMode: AgentRuntimeMode;
  status: AgentStatus;
  model: string;
  description: string;
  maxConcurrentTasks: number;
  host?: string;
  skills: AgentSkill[];
  tools: AgentTool[];
  currentTasks: AgentTask[];
  completedTasks: number;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Mock data
// ---------------------------------------------------------------------------

const MOCK_AGENTS: MockAgent[] = [
  {
    id: "agent_1",
    name: "Claude-1",
    avatar: "C1",
    runtimeMode: "local",
    status: "working",
    model: "Claude Sonnet 4",
    description:
      "General-purpose coding agent for backend development. Specializes in Go API development, database migrations, and test writing.",
    maxConcurrentTasks: 2,
    host: "jiayuan-macbook",
    skills: [
      {
        id: "sk_1",
        name: "Go API Development",
        description: "Build RESTful APIs with Chi, implement CRUD handlers, add middleware",
      },
      {
        id: "sk_2",
        name: "Database Migrations",
        description: "Create and run PostgreSQL migrations, update sqlc queries",
      },
      {
        id: "sk_3",
        name: "Test Writing",
        description: "Write Go unit and integration tests with testcontainers",
      },
    ],
    tools: [
      { id: "t_1", name: "GitHub", icon: GitBranch, connected: true },
      { id: "t_2", name: "Terminal", icon: Terminal, connected: true },
      { id: "t_3", name: "PostgreSQL", icon: Database, connected: true },
      { id: "t_4", name: "Browser", icon: Globe, connected: false },
    ],
    currentTasks: [
      {
        id: "iss_9",
        issueKey: "MUL-9",
        title: "Implement issue list API endpoint",
        status: "working",
      },
      {
        id: "iss_14",
        issueKey: "MUL-14",
        title: "Add WebSocket event types for agent status",
        status: "queued",
      },
    ],
    completedTasks: 12,
    createdAt: "2026-03-15T10:00:00Z",
  },
  {
    id: "agent_2",
    name: "Codex-1",
    avatar: "CX",
    runtimeMode: "cloud",
    status: "idle",
    model: "GPT-5.3 Codex",
    description:
      "Cloud-hosted coding agent optimized for frontend development. Handles React components, styling, and TypeScript refactoring.",
    maxConcurrentTasks: 4,
    skills: [
      {
        id: "sk_4",
        name: "React Components",
        description: "Build UI components with React, Radix UI, and Tailwind CSS",
      },
      {
        id: "sk_5",
        name: "TypeScript Refactoring",
        description: "Refactor code for type safety, extract shared types and utilities",
      },
    ],
    tools: [
      { id: "t_5", name: "GitHub", icon: GitBranch, connected: true },
      { id: "t_6", name: "Terminal", icon: Terminal, connected: true },
      { id: "t_7", name: "Browser", icon: Globe, connected: true },
      { id: "t_8", name: "Figma", icon: FileCode, connected: false },
    ],
    currentTasks: [],
    completedTasks: 8,
    createdAt: "2026-03-16T14:00:00Z",
  },
  {
    id: "agent_3",
    name: "Review Bot",
    avatar: "RB",
    runtimeMode: "cloud",
    status: "working",
    model: "Claude Sonnet 4",
    description:
      "Automated code reviewer. Analyzes PRs for correctness, security issues, and adherence to team coding standards.",
    maxConcurrentTasks: 8,
    skills: [
      {
        id: "sk_6",
        name: "Code Review",
        description: "Review pull requests for bugs, security issues, and style violations",
      },
      {
        id: "sk_7",
        name: "Security Audit",
        description: "Check for OWASP top 10 vulnerabilities and insecure patterns",
      },
    ],
    tools: [
      { id: "t_9", name: "GitHub", icon: GitBranch, connected: true },
      { id: "t_10", name: "Comments", icon: MessageSquare, connected: true },
    ],
    currentTasks: [
      {
        id: "iss_pr47",
        issueKey: "PR-47",
        title: "Review: Add WebSocket reconnection logic",
        status: "working",
      },
    ],
    completedTasks: 34,
    createdAt: "2026-03-14T09:00:00Z",
  },
  {
    id: "agent_4",
    name: "Claude-2",
    avatar: "C2",
    runtimeMode: "local",
    status: "offline",
    model: "Claude Sonnet 4",
    description:
      "Secondary local agent on Bohan's machine. Used for documentation and knowledge base tasks.",
    maxConcurrentTasks: 1,
    host: "bohan-macbook",
    skills: [
      {
        id: "sk_8",
        name: "Documentation",
        description: "Write and update technical docs, API references, and README files",
      },
    ],
    tools: [
      { id: "t_11", name: "GitHub", icon: GitBranch, connected: true },
      { id: "t_12", name: "Terminal", icon: Terminal, connected: true },
    ],
    currentTasks: [],
    completedTasks: 5,
    createdAt: "2026-03-18T16:00:00Z",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const statusConfig: Record<AgentStatus, { label: string; color: string; dot: string }> = {
  idle: { label: "Idle", color: "text-muted-foreground", dot: "bg-muted-foreground" },
  working: { label: "Working", color: "text-green-600", dot: "bg-green-500" },
  blocked: { label: "Blocked", color: "text-yellow-600", dot: "bg-yellow-500" },
  error: { label: "Error", color: "text-red-600", dot: "bg-red-500" },
  offline: { label: "Offline", color: "text-muted-foreground/50", dot: "bg-muted-foreground/40" },
};

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function AgentListItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: MockAgent;
  isSelected: boolean;
  onClick: () => void;
}) {
  const st = statusConfig[agent.status];

  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      {/* Avatar */}
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
        {agent.avatar}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {agent.runtimeMode === "cloud" ? (
            <Cloud className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Monitor className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          <span className={`text-xs ${st.color}`}>{st.label}</span>
          {agent.currentTasks.length > 0 && (
            <span className="text-xs text-muted-foreground">
              · {agent.currentTasks.length} task{agent.currentTasks.length > 1 ? "s" : ""}
            </span>
          )}
        </div>
      </div>
    </button>
  );
}

function SectionHeader({
  icon: Icon,
  title,
  count,
}: {
  icon: typeof Wrench;
  title: string;
  count?: number;
}) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <Icon className="h-4 w-4 text-muted-foreground" />
      <h3 className="text-sm font-semibold">{title}</h3>
      {count !== undefined && (
        <span className="text-xs text-muted-foreground">({count})</span>
      )}
    </div>
  );
}

function AgentDetail({ agent }: { agent: MockAgent }) {
  const st = statusConfig[agent.status];

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold">
          {agent.avatar}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{agent.name}</h2>
            <span className={`flex items-center gap-1.5 text-sm ${st.color}`}>
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {st.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{agent.description}</p>
        </div>
      </div>

      {/* Meta info */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
        <div>
          <div className="text-xs text-muted-foreground">Runtime</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
            {agent.runtimeMode === "cloud" ? (
              <Cloud className="h-3.5 w-3.5" />
            ) : (
              <Monitor className="h-3.5 w-3.5" />
            )}
            {agent.runtimeMode === "cloud" ? "Cloud" : "Local"}
            {agent.host && (
              <span className="text-muted-foreground font-normal">({agent.host})</span>
            )}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Model</div>
          <div className="mt-1 text-sm font-medium">{agent.model}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Concurrency</div>
          <div className="mt-1 text-sm font-medium">
            {agent.currentTasks.filter((t) => t.status === "working").length} / {agent.maxConcurrentTasks} slots
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Completed Tasks</div>
          <div className="mt-1 text-sm font-medium">{agent.completedTasks}</div>
        </div>
      </div>

      {/* Skills */}
      <div>
        <SectionHeader icon={Zap} title="Skills" count={agent.skills.length} />
        <div className="space-y-2">
          {agent.skills.map((skill) => (
            <div
              key={skill.id}
              className="rounded-lg border px-4 py-3"
            >
              <div className="text-sm font-medium">{skill.name}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                {skill.description}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Connected Tools */}
      <div>
        <SectionHeader icon={Blocks} title="Connected Tools" count={agent.tools.length} />
        <div className="grid grid-cols-2 gap-2">
          {agent.tools.map((tool) => (
            <div
              key={tool.id}
              className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                tool.connected ? "" : "opacity-50"
              }`}
            >
              <tool.icon className="h-4 w-4 shrink-0 text-muted-foreground" />
              <span className="text-sm">{tool.name}</span>
              {tool.connected ? (
                <span className="ml-auto text-xs text-green-600">Connected</span>
              ) : (
                <span className="ml-auto text-xs text-muted-foreground">Not set up</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Current Tasks */}
      <div>
        <SectionHeader icon={ListTodo} title="Current Tasks" count={agent.currentTasks.length} />
        {agent.currentTasks.length > 0 ? (
          <div className="space-y-2">
            {agent.currentTasks.map((task) => (
              <div
                key={task.id}
                className="flex items-center gap-3 rounded-lg border px-4 py-3"
              >
                <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs font-mono font-medium">
                  {task.issueKey}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm">{task.title}</span>
                <span
                  className={`shrink-0 text-xs ${
                    task.status === "working" ? "text-green-600" : "text-muted-foreground"
                  }`}
                >
                  {task.status === "working" ? "Working" : "Queued"}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">No active tasks</p>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const [selectedId, setSelectedId] = useState<string>(MOCK_AGENTS[0]?.id ?? "");
  const selected = MOCK_AGENTS.find((a) => a.id === selectedId) ?? null;

  return (
    <div className="flex h-full">
      {/* Left column — agent list */}
      <div className="w-72 shrink-0 overflow-y-auto border-r">
        <div className="flex h-12 items-center justify-between border-b px-4">
          <h1 className="text-sm font-semibold">Agents</h1>
          <button className="flex h-6 w-6 items-center justify-center rounded-md hover:bg-accent">
            <Plus className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>
        <div className="divide-y">
          {MOCK_AGENTS.map((agent) => (
            <AgentListItem
              key={agent.id}
              agent={agent}
              isSelected={agent.id === selectedId}
              onClick={() => setSelectedId(agent.id)}
            />
          ))}
        </div>
      </div>

      {/* Right column — agent detail */}
      <div className="flex-1 overflow-y-auto">
        {selected ? (
          <AgentDetail agent={selected} />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select an agent to view details
          </div>
        )}
      </div>
    </div>
  );
}
