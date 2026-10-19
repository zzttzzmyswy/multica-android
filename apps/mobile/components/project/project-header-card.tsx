/**
 * Header card for the project detail screen. Large emoji icon centered above
 * the title, with the description shown in full (no truncation) below.
 *
 * Mirrors the visual emphasis of web's `project-header.tsx` but in a single
 * vertical stack instead of the web sidebar layout — phones don't have the
 * horizontal real estate for a side-by-side header + properties layout.
 *
 * Progress section mirrors web `packages/views/projects/components/project-detail.tsx:596-620`:
 * horizontal bar driven by `Project.done_count / Project.issue_count` plus a
 * "X / Y" label and a percentage. Hidden when there are zero issues — empty
 * bar gives no information and creates a divide-by-zero hazard.
 *
 * The description is Markdown, rendered through the shared `lib/markdown`
 * pipeline — web's project description is a `ContentEditor` (a real markdown
 * editor, `project-detail.tsx:453-465`), so a project written on the web with
 * headings, lists, links or code arrives here as markdown source. Rendering it
 * as a plain `<Text>` showed that source verbatim ("## Goals", literal
 * brackets around links) and would have round-tripped the raw text back on the
 * next mobile save.
 */
import { Pressable, View } from "react-native";
import type { Project } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { ProjectIcon } from "@/components/ui/project-icon";
import { Markdown } from "@/lib/markdown";
import { useTranslation } from "@/lib/i18n/react";

interface Props {
  project: Project;
  onEdit?: () => void;
}

export function ProjectHeaderCard({ project, onEdit }: Props) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onEdit}
      disabled={!onEdit}
      className="px-4 pt-4 pb-3 active:bg-secondary/40"
    >
      <View className="items-start gap-2">
        <ProjectIcon icon={project.icon} size="lg" />
        <Text
          className="text-display-sm font-bold text-foreground"
          selectable
        >
          {project.title}
        </Text>
        {project.description ? (
          <View className="w-full">
            <Markdown content={project.description} />
          </View>
        ) : onEdit ? (
          <Text className="text-body text-muted-foreground/60 italic">
            {t("project.addDescription")}
          </Text>
        ) : null}
        {project.issue_count > 0 ? (
          <ProgressSection
            done={project.done_count}
            total={project.issue_count}
          />
        ) : null}
      </View>
    </Pressable>
  );
}

function ProgressSection({ done, total }: { done: number; total: number }) {
  const { t } = useTranslation();
  const pct = Math.round((done / total) * 100);
  return (
    <View className="w-full pt-2 gap-1.5">
      <View className="flex-row items-center justify-between">
        <Text className="text-caption uppercase tracking-wider text-muted-foreground">
          {t("project.progress")}
        </Text>
        <Text className="text-caption text-muted-foreground">
          {done} / {total} · {pct}%
        </Text>
      </View>
      <View className="h-1.5 bg-secondary rounded-full overflow-hidden">
        <View
          className="h-full bg-brand rounded-full"
          style={{ width: `${pct}%` }}
        />
      </View>
    </View>
  );
}
