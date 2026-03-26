"use client";

import { ChevronDown, Columns3, List, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useModalStore } from "@/features/modals";
import {
  ALL_STATUSES,
  STATUS_CONFIG,
  PRIORITY_ORDER,
  PRIORITY_CONFIG,
} from "@/features/issues/config";
import { StatusIcon, PriorityIcon } from "@/features/issues/components";
import { useIssueViewStore } from "@/features/issues/stores/view-store";

function formatFilterLabel(
  prefix: string,
  selected: string[],
  configMap: Record<string, { label: string }>
) {
  if (selected.length === 0) return `${prefix}: All`;
  if (selected.length === 1) {
    const key = selected[0];
    if (key) return `${prefix}: ${configMap[key]?.label ?? key}`;
  }
  return `${prefix}: ${selected.length} selected`;
}

export function IssuesHeader() {
  const viewMode = useIssueViewStore((s) => s.viewMode);
  const statusFilters = useIssueViewStore((s) => s.statusFilters);
  const priorityFilters = useIssueViewStore((s) => s.priorityFilters);
  const setViewMode = useIssueViewStore((s) => s.setViewMode);
  const toggleStatusFilter = useIssueViewStore((s) => s.toggleStatusFilter);
  const togglePriorityFilter = useIssueViewStore((s) => s.togglePriorityFilter);

  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2">
        {/* Status filter */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="whitespace-nowrap text-xs">
                {formatFilterLabel("Status", statusFilters, STATUS_CONFIG)}
                <ChevronDown className="text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Status</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  useIssueViewStore.setState({ statusFilters: [] })
                }
              >
                All
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {ALL_STATUSES.map((s) => (
                <DropdownMenuCheckboxItem
                  key={s}
                  checked={statusFilters.length === 0 || statusFilters.includes(s)}
                  onCheckedChange={() => toggleStatusFilter(s)}
                >
                  <StatusIcon status={s} className="h-3.5 w-3.5" />
                  {STATUS_CONFIG[s].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* Priority filter */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm" className="whitespace-nowrap text-xs">
                {formatFilterLabel("Priority", priorityFilters, PRIORITY_CONFIG)}
                <ChevronDown className="text-muted-foreground" />
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>Priority</DropdownMenuLabel>
              <DropdownMenuItem
                onClick={() =>
                  useIssueViewStore.setState({ priorityFilters: [] })
                }
              >
                All
              </DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {PRIORITY_ORDER.map((p) => (
                <DropdownMenuCheckboxItem
                  key={p}
                  checked={priorityFilters.length === 0 || priorityFilters.includes(p)}
                  onCheckedChange={() => togglePriorityFilter(p)}
                >
                  <PriorityIcon priority={p} />
                  {PRIORITY_CONFIG[p].label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-center gap-2">
        {/* View toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                {viewMode === "board" ? <Columns3 /> : <List />}
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="w-auto">
            <DropdownMenuGroup>
              <DropdownMenuLabel>View</DropdownMenuLabel>
              <DropdownMenuItem onClick={() => setViewMode("board")}>
                <Columns3 />
                Board
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => setViewMode("list")}>
                <List />
                List
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>

        {/* New issue */}
        <Button
          variant="outline"
          size="sm"
          onClick={() => useModalStore.getState().open("create-issue")}
        >
          <Plus />
          New Issue
        </Button>
      </div>
    </div>
  );
}
