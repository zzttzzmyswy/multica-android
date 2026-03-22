"use client";

import { useState, useEffect } from "react";
import {
  Bot,
  Cloud,
  Monitor,
  Plus,
  Zap,
  ListTodo,
} from "lucide-react";
import type { Agent, AgentStatus } from "@multica/types";
import { api } from "../../../lib/api";

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

function getInitials(name: string): string {
  return name
    .split(/[\s-]+/)
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

// ---------------------------------------------------------------------------
// Components
// ---------------------------------------------------------------------------

function AgentListItem({
  agent,
  isSelected,
  onClick,
}: {
  agent: Agent;
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-xs font-semibold">
        {getInitials(agent.name)}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium">{agent.name}</span>
          {agent.runtime_mode === "cloud" ? (
            <Cloud className="h-3 w-3 text-muted-foreground" />
          ) : (
            <Monitor className="h-3 w-3 text-muted-foreground" />
          )}
        </div>
        <div className="flex items-center gap-1.5 mt-0.5">
          <span className={`h-1.5 w-1.5 rounded-full ${st.dot}`} />
          <span className={`text-xs ${st.color}`}>{st.label}</span>
        </div>
      </div>
    </button>
  );
}

function AgentDetail({ agent }: { agent: Agent }) {
  const st = statusConfig[agent.status];

  return (
    <div className="p-6 space-y-8">
      {/* Header */}
      <div className="flex items-start gap-4">
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-sm font-bold">
          {getInitials(agent.name)}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-3">
            <h2 className="text-lg font-semibold">{agent.name}</h2>
            <span className={`flex items-center gap-1.5 text-sm ${st.color}`}>
              <span className={`h-2 w-2 rounded-full ${st.dot}`} />
              {st.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {agent.runtime_mode === "cloud" ? "Cloud-hosted" : "Local"} agent
          </p>
        </div>
      </div>

      {/* Meta info */}
      <div className="grid grid-cols-2 gap-4 rounded-lg border p-4">
        <div>
          <div className="text-xs text-muted-foreground">Runtime</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm font-medium">
            {agent.runtime_mode === "cloud" ? (
              <Cloud className="h-3.5 w-3.5" />
            ) : (
              <Monitor className="h-3.5 w-3.5" />
            )}
            {agent.runtime_mode === "cloud" ? "Cloud" : "Local"}
          </div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Visibility</div>
          <div className="mt-1 text-sm font-medium capitalize">{agent.visibility}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Max Concurrent Tasks</div>
          <div className="mt-1 text-sm font-medium">{agent.max_concurrent_tasks}</div>
        </div>
        <div>
          <div className="text-xs text-muted-foreground">Created</div>
          <div className="mt-1 text-sm font-medium">
            {new Date(agent.created_at).toLocaleDateString()}
          </div>
        </div>
      </div>

      {/* Status */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Zap className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Status</h3>
        </div>
        <div className="rounded-lg border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${st.dot}`} />
            <span className={`text-sm font-medium ${st.color}`}>{st.label}</span>
          </div>
        </div>
      </div>

      {/* Tasks placeholder */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <ListTodo className="h-4 w-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold">Tasks</h3>
        </div>
        <p className="text-sm text-muted-foreground">
          Task queue will be shown here when agents are assigned issues.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function AgentsPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .listAgents()
      .then((a) => {
        setAgents(a);
        if (a.length > 0) setSelectedId(a[0]!.id);
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const selected = agents.find((a) => a.id === selectedId) ?? null;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

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
          {agents.map((agent) => (
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
