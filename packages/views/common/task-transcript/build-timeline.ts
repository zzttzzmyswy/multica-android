/**
 * The implementation lives in `@multica/core/task-transcript` so the mobile
 * client can share it; this module keeps the views-internal import path.
 */
export {
  appendTimelineItem,
  buildTimeline,
  coalesceTimelineItems,
  type TimelineItem,
} from "@multica/core/task-transcript";
