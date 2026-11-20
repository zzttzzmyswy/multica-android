/**
 * Loading skeleton for issue-list surfaces — My Issues (`(tabs)/my-issues.tsx`)
 * and workspace Issues (`more/issues.tsx`). Both group issues by status via
 * SectionList; this skeleton mirrors that shape so the eye immediately sees
 * a list-like structure instead of a centered spinner. Mirrors the
 * "perceived perf wins over centered spinner" pattern from InboxLoading.
 *
 * Row skeleton follows the title-first, two-tier IssueRow layout.
 */
import { View } from "react-native";
import { Skeleton } from "@/components/ui/skeleton";

export function IssuesLoading() {
  return (
    <View className="pt-2">
      {Array.from({ length: 2 }).map((_, sectionIdx) => (
        <View key={sectionIdx} className="pb-2">
          <View className="px-4 py-2 flex-row items-center gap-2">
            <Skeleton className="size-3.5 rounded-full" />
            <Skeleton className="h-3 w-20" />
          </View>
          {Array.from({ length: 3 }).map((_, rowIdx) => (
            <View key={rowIdx} className="gap-2 px-4 py-3.5">
              <Skeleton className={rowIdx % 2 ? "h-4 w-3/5" : "h-4 w-4/5"} />
              <View className="flex-row items-center gap-2">
                <Skeleton className="size-3.5 rounded-full" />
                <Skeleton className="h-3 w-14" />
                <Skeleton className="size-5 rounded-full" />
              </View>
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}
