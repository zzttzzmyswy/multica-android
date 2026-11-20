/** Preserve React Query's last successful rows while reporting refresh failure.
 * An unanswered/failed read must never assert that the project has no resources.
 */
export function projectResourceState({
  resources,
  isError,
}: {
  resources: readonly unknown[] | undefined;
  isError: boolean;
}): "loading" | "error" | "empty" | "ready" | "stale" {
  if (resources === undefined) return isError ? "error" : "loading";
  if (isError) return "stale";
  return resources.length === 0 ? "empty" : "ready";
}
