import type { IssueStatus } from "@multica/core/types";
import { isIssueStatusCategory } from "@multica/core/issues";
import { StatusIcon } from "./status-icon";
import { useT } from "../../i18n";

export function StatusHeading({
  status,
  count,
}: {
  status: IssueStatus;
  count: number;
}) {
  const { t } = useT("issues");
  return (
    <div className="flex items-center gap-2">
      <span className="inline-flex items-center gap-1.5 text-caption font-semibold">
        <StatusIcon status={status} className="h-3 w-3" />
        {isIssueStatusCategory(status) ? t(($) => $.status[status]) : status}
      </span>
      <span className="text-caption text-muted-foreground">{count}</span>
    </div>
  );
}
