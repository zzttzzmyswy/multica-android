import { Server } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import type { AgentRuntime, MemberWithUser } from "@multica/core/types";
import { useWorkspaceId } from "@multica/core/hooks";
import { memberListOptions } from "@multica/core/workspace/queries";
import { ActorAvatar } from "../../common/actor-avatar";
import { RuntimeModeIcon } from "./shared";

type RuntimeFilter = "mine" | "all";

function RuntimeListItem({
  runtime,
  isSelected,
  ownerMember,
  onClick,
}: {
  runtime: AgentRuntime;
  isSelected: boolean;
  ownerMember: MemberWithUser | null;
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
        <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
          {ownerMember && (
            <>
              <ActorAvatar
                actorType="member"
                actorId={ownerMember.user_id}
                size={14}
              />
              <span className="truncate">{ownerMember.name}</span>
              <span>&middot;</span>
            </>
          )}
          <span className="truncate">{runtime.provider}</span>
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
  ownerFilter,
  onOwnerFilterChange,
}: {
  runtimes: AgentRuntime[];
  selectedId: string;
  onSelect: (id: string) => void;
  filter: RuntimeFilter;
  onFilterChange: (filter: RuntimeFilter) => void;
  ownerFilter: string | null;
  onOwnerFilterChange: (ownerId: string | null) => void;
}) {
  const wsId = useWorkspaceId();
  const { data: members = [] } = useQuery(memberListOptions(wsId));

  const getOwnerMember = (ownerId: string | null) => {
    if (!ownerId) return null;
    return members.find((m) => m.user_id === ownerId) ?? null;
  };

  // Get unique owners from runtimes for filter dropdown
  const uniqueOwners = filter === "all"
    ? Array.from(new Set(runtimes.map((r) => r.owner_id).filter(Boolean) as string[]))
        .map((id) => members.find((m) => m.user_id === id))
        .filter(Boolean) as MemberWithUser[]
    : [];

  // Apply client-side owner filter when in "all" mode
  const filteredRuntimes = filter === "all" && ownerFilter
    ? runtimes.filter((r) => r.owner_id === ownerFilter)
    : runtimes;

  return (
    <div className="overflow-y-auto h-full border-r">
      <div className="flex h-12 items-center justify-between border-b px-4">
        <h1 className="text-sm font-semibold">Runtimes</h1>
        <span className="text-xs text-muted-foreground">
          {filteredRuntimes.filter((r) => r.status === "online").length}/
          {filteredRuntimes.length} online
        </span>
      </div>

      {/* Filter toggle */}
      <div className="flex items-center gap-1 border-b px-4 py-2">
        <button
          onClick={() => { onFilterChange("mine"); onOwnerFilterChange(null); }}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            filter === "mine"
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          Mine
        </button>
        <button
          onClick={() => { onFilterChange("all"); onOwnerFilterChange(null); }}
          className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
            filter === "all" && !ownerFilter
              ? "bg-accent text-accent-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          All
        </button>

        {/* Owner filter pills (shown in "all" mode when there are multiple owners) */}
        {filter === "all" && uniqueOwners.length > 1 && (
          <>
            <div className="mx-1 h-4 w-px bg-border" />
            {uniqueOwners.map((m) => (
              <button
                key={m.user_id}
                onClick={() => onOwnerFilterChange(ownerFilter === m.user_id ? null : m.user_id)}
                className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  ownerFilter === m.user_id
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
                title={m.name}
              >
                <ActorAvatar
                  actorType="member"
                  actorId={m.user_id}
                  size={14}
                />
                <span className="max-w-16 truncate">{m.name}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {filteredRuntimes.length === 0 ? (
        <div className="flex flex-col items-center justify-center px-4 py-12">
          <Server className="h-8 w-8 text-muted-foreground/40" />
          <p className="mt-3 text-sm text-muted-foreground">
            {filter === "mine" ? "No runtimes owned by you" : ownerFilter ? "No runtimes for this owner" : "No runtimes registered"}
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
          {filteredRuntimes.map((runtime) => (
            <RuntimeListItem
              key={runtime.id}
              runtime={runtime}
              isSelected={runtime.id === selectedId}
              ownerMember={getOwnerMember(runtime.owner_id)}
              onClick={() => onSelect(runtime.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
