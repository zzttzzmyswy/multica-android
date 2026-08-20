/**
 * Mobile mirror of @multica/core/runtimes/cloud-runtime.ts helpers
 * (iteration-82, A2.2). `isCloudRuntimeNodePending` drives the dialog's 5s
 * poll and the row-level spinning badge while a node is launching.
 */
const PENDING_NODE_STATUSES = new Set([
  "launching",
  "pending",
  "starting",
  "stopping",
  "rebooting",
  "terminating",
]);

export function isCloudRuntimeNodePending(status: string): boolean {
  return PENDING_NODE_STATUSES.has(status.toLowerCase());
}