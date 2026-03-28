"use client";

import { useMemo } from "react";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Columns3,
  Filter,
  List,
  Plus,
  SlidersHorizontal,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useIssueStore } from "@/features/issues/store";
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { Switch } from "@/components/ui/switch";
import { useModalStore } from "@/features/modals";
import {
  ALL_STATUSES,
  STATUS_CONFIG,
  PRIORITY_ORDER,
  PRIORITY_CONFIG,
} from "@/features/issues/config";
import { StatusIcon, PriorityIcon } from "@/features/issues/components";
import {
  useIssueViewStore,
  SORT_OPTIONS,
  CARD_PROPERTY_OPTIONS,
} from "@/features/issues/stores/view-store";

export function IssuesHeader() {
  const viewMode = useIssueViewStore((s) => s.viewMode);
  const statusFilters = useIssueViewStore((s) => s.statusFilters);
  const priorityFilters = useIssueViewStore((s) => s.priorityFilters);
  const sortBy = useIssueViewStore((s) => s.sortBy);
  const sortDirection = useIssueViewStore((s) => s.sortDirection);
  const cardProperties = useIssueViewStore((s) => s.cardProperties);
  const setViewMode = useIssueViewStore((s) => s.setViewMode);
  const toggleStatusFilter = useIssueViewStore((s) => s.toggleStatusFilter);
  const togglePriorityFilter = useIssueViewStore((s) => s.togglePriorityFilter);
  const setSortBy = useIssueViewStore((s) => s.setSortBy);
  const setSortDirection = useIssueViewStore((s) => s.setSortDirection);
  const toggleCardProperty = useIssueViewStore((s) => s.toggleCardProperty);
  const clearFilters = useIssueViewStore((s) => s.clearFilters);

  const allIssues = useIssueStore((s) => s.issues);

  const filteredCount = useMemo(() => {
    return allIssues.filter((i) => {
      if (statusFilters.length > 0 && !statusFilters.includes(i.status))
        return false;
      if (
        priorityFilters.length > 0 &&
        !priorityFilters.includes(i.priority)
      )
        return false;
      return true;
    }).length;
  }, [allIssues, statusFilters, priorityFilters]);

  const sortLabel =
    SORT_OPTIONS.find((o) => o.value === sortBy)?.label ?? "Manual";
  const hasActiveFilters =
    statusFilters.length > 0 || priorityFilters.length > 0;

  return (
    <div className="flex h-12 shrink-0 items-center justify-between px-4">
      <div className="flex items-center gap-2">
        {/* View toggle */}
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button variant="outline" size="sm">
                {viewMode === "board" ? <Columns3 className="size-3.5" /> : <List className="size-3.5" />}
                {viewMode === "board" ? "Board" : "List"}
              </Button>
            }
          />
          <DropdownMenuContent align="start" className="w-auto">
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

        {/* Filter */}
        <Popover>
          <PopoverTrigger
            render={
              <Button
                variant="outline"
                size="sm"
                className={hasActiveFilters ? "border-primary/50 text-primary" : ""}
              >
                <Filter className="size-3.5" />
                Filter
                {hasActiveFilters && (
                  <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {statusFilters.length + priorityFilters.length}
                  </span>
                )}
              </Button>
            }
          />
          <PopoverContent align="start" className="w-64 p-0">
            {/* Status */}
            <div className="border-b px-3 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                Status
              </span>
              <div className="mt-1.5 space-y-0.5">
                {ALL_STATUSES.map((s) => (
                  <label
                    key={s}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
                    onClick={() => toggleStatusFilter(s)}
                  >
                    <div
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        statusFilters.length === 0 || statusFilters.includes(s)
                          ? "border-primary bg-primary"
                          : "border-input"
                      }`}
                    >
                      {(statusFilters.length === 0 ||
                        statusFilters.includes(s)) && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-3 w-3 text-primary-foreground"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                    <StatusIcon status={s} className="h-3.5 w-3.5" />
                    <span className="text-sm">{STATUS_CONFIG[s].label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Priority */}
            <div className="border-b px-3 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                Priority
              </span>
              <div className="mt-1.5 space-y-0.5">
                {PRIORITY_ORDER.map((p) => (
                  <label
                    key={p}
                    className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 hover:bg-accent"
                    onClick={() => togglePriorityFilter(p)}
                  >
                    <div
                      className={`flex h-4 w-4 items-center justify-center rounded border ${
                        priorityFilters.length === 0 ||
                        priorityFilters.includes(p)
                          ? "border-primary bg-primary"
                          : "border-input"
                      }`}
                    >
                      {(priorityFilters.length === 0 ||
                        priorityFilters.includes(p)) && (
                        <svg
                          viewBox="0 0 12 12"
                          className="h-3 w-3 text-primary-foreground"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <path d="M2 6l3 3 5-5" />
                        </svg>
                      )}
                    </div>
                    <PriorityIcon priority={p} />
                    <span className="text-sm">{PRIORITY_CONFIG[p].label}</span>
                  </label>
                ))}
              </div>
            </div>

            {/* Reset */}
            {hasActiveFilters && (
              <div className="px-3 py-2">
                <Button
                  variant="link"
                  size="xs"
                  className="text-muted-foreground hover:text-foreground"
                  onClick={clearFilters}
                >
                  Reset filters
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>

        {/* Display settings */}
        <Popover>
          <PopoverTrigger
            render={
              <Button variant="outline" size="sm">
                <SlidersHorizontal className="size-3.5" />
                Display
              </Button>
            }
          />
          <PopoverContent align="start" className="w-64 p-0">
            {/* Ordering section */}
            <div className="border-b px-3 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                Ordering
              </span>
              <div className="mt-2 flex items-center gap-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger
                    render={
                      <Button
                        variant="outline"
                        size="sm"
                        className="flex-1 justify-between text-xs"
                      >
                        {sortLabel}
                        <ChevronDown className="size-3 text-muted-foreground" />
                      </Button>
                    }
                  />
                  <DropdownMenuContent align="start" className="w-auto">
                    {SORT_OPTIONS.map((opt) => (
                      <DropdownMenuItem
                        key={opt.value}
                        onClick={() => setSortBy(opt.value)}
                      >
                        {opt.label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() =>
                    setSortDirection(sortDirection === "asc" ? "desc" : "asc")
                  }
                  title={sortDirection === "asc" ? "Ascending" : "Descending"}
                >
                  {sortDirection === "asc" ? (
                    <ArrowUp className="size-3.5" />
                  ) : (
                    <ArrowDown className="size-3.5" />
                  )}
                </Button>
              </div>
            </div>

            {/* Card properties section */}
            <div className="px-3 py-2.5">
              <span className="text-xs font-medium text-muted-foreground">
                Card properties
              </span>
              <div className="mt-2 space-y-2">
                {CARD_PROPERTY_OPTIONS.map((opt) => (
                  <label
                    key={opt.key}
                    className="flex cursor-pointer items-center justify-between"
                  >
                    <span className="text-sm">{opt.label}</span>
                    <Switch
                      size="sm"
                      checked={cardProperties[opt.key]}
                      onCheckedChange={() => toggleCardProperty(opt.key)}
                    />
                  </label>
                ))}
              </div>
            </div>
          </PopoverContent>
        </Popover>
      </div>

      <div className="flex items-center gap-3">
        <span className="text-xs text-muted-foreground">
          {filteredCount} {filteredCount === 1 ? "Issue" : "Issues"}
        </span>
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
