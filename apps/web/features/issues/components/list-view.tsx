"use client";

import type { Issue } from "@multica/types";
import { STATUS_ORDER, STATUS_CONFIG } from "@/features/issues/config";
import { StatusIcon } from "./status-icon";
import { ListRow } from "./list-row";

export function ListView({ issues }: { issues: Issue[] }) {
  const groupOrder = STATUS_ORDER.filter((s) => s !== "cancelled");

  return (
    <div className="overflow-y-auto">
      {groupOrder.map((status) => {
        const cfg = STATUS_CONFIG[status];
        const filtered = issues.filter((i) => i.status === status);
        if (filtered.length === 0) return null;
        return (
          <div key={status}>
            <div className="flex h-8 items-center gap-2 border-b px-4">
              <StatusIcon status={status} className="h-3.5 w-3.5" />
              <span className="text-xs font-medium">{cfg.label}</span>
              <span className="text-xs text-muted-foreground">
                {filtered.length}
              </span>
            </div>
            {filtered.map((issue) => (
              <ListRow key={issue.id} issue={issue} />
            ))}
          </div>
        );
      })}
    </div>
  );
}
