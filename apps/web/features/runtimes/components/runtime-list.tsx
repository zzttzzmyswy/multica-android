import { Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { AgentRuntime } from "@/shared/types";
import { useWorkspaceId } from "@core/hooks";
import { memberListOptions } from "@core/workspace/queries";
import { RuntimeModeIcon } from "./shared";

type RuntimeFilter = "mine" | "all";

function RuntimeListItem({
  runtime,
  isSelected,
  ownerName,
  onClick,
}: {
  runtime: AgentRuntime;
  isSelected: boolean;
  ownerName: string | null;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-4 py-3 text-left transition-colors ${
        isSelected ? "bg-accent" : "hover:bg-accent/50"
      }`}
    >
      <div
        className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
          runtime.status === "online" ? "bg-success/10" : "bg-muted"
        }`}
      >
        <RuntimeModeIcon mode={runtime.runtime_mode} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{runtime.name}</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {runtime.provider} &middot; {runtime.runtime_mode}
          {ownerName && <> &middot; {ownerName}</>}
        </div>
      </div>
      <div
        className={`h-2 w-2 shrink-0 rounded-full ${
          runtime.status === "online" ? "bg-success" : "bg-muted-foreground/40"
        }`}
      />
    </button>
  );
}

export function RuntimeList({
  runtimes,
  selectedId,
  onSelect,
  filter,
  onFilterChange,
}: {
  runtimes: AgentRuntime[];
  selectedId: string;
  onSelect: (id: string) => void;
  filter: RuntimeFilter;
  onFilterChange: (filter: RuntimeFilter) => void;
}) {
  const wsId = useWorkspaceId();
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const getOwnerName = (ownerId: string | null) => {
    if (!ownerId) return null;
    return members.find((m) => m.user_id === ownerId)?.name ?? null;
  };

  return (
    <div className="overflow-y-auto h-full border-r">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <h1 className="text-sm font-semibold">Runtimes</h1>
        <span className="text-xs text-muted-foreground">
          {runtimes.filter((r) => r.status === "online").length}/
          {runtimes.length} online
        </span>
      </div>

      {/* Filter toggle */}
      <div className="flex border-b px-4 py-2 gap-1">
        <button
          onClick={() => onFilterChange("mine")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            filter === "mine"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Mine
        </button>
        <button
          onClick={() => onFilterChange("all")}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            filter === "all"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>
      </div>

      {runtimes.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12">
          <Server className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {filter === "mine" ? "No runtimes owned by you" : "No runtimes registered"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground text-center">
            Run{" "}
            <code className="rounded bg-muted px-1 py-0.5">
              multica daemon start
            </code>{" "}
            to register a local runtime.
          </p>
        </div>
      ) : (
        <div className="divide-y">
          {runtimes.map((runtime) => (
            <RuntimeListItem
              key={runtime.id}
              runtime={runtime}
              isSelected={runtime.id === selectedId}
              ownerName={filter === "all" ? getOwnerName(runtime.owner_id) : null}
              onClick={() => onSelect(runtime.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
