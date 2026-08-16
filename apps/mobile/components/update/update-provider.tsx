/**
 * Silent startup update probe. Mounted once in the workspace root layout —
 * while the user works, it fetches the latest GitHub release and mirrors the
 * "is there a newer APK?" answer into the update store so the More popover's
 * About row can render a dot without owning a query.
 *
 * Failures are intentionally silent: a blocked GitHub request must never
 * disturb the workspace. The About page's manual check uses the same query
 * via `refetch()` and renders its own error copy.
 */
import { useLatestRelease } from "@/lib/use-latest-release";

export function UpdateProvider({ children }: { children: React.ReactNode }) {
  useLatestRelease(true);
  return <>{children}</>;
}