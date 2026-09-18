/**
 * Project picker for the chat composer's project-context chip. Reuses the
 * shared `ProjectPickerBody` + native-search-bar mechanism (same as
 * `issue/[id]/picker/project.tsx` and `new-issue-picker/project.tsx`); the
 * session id rides in as a route param, and the pick writes straight through
 * the chat-session mutation before popping back to the composer.
 */
import { useMemo } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { findProject, projectListOptions } from "@/data/queries/projects";
import { useSetChatSessionProject } from "@/data/mutations/chat";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import { useTranslation } from "@/lib/i18n/react";

export default function ChatProjectPickerRoute() {
  const { t } = useTranslation();
  const { sessionId, projectId } = useLocalSearchParams<{
    sessionId: string;
    projectId?: string;
  }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const setProject = useSetChatSessionProject();
  const query = useNativeSearchBar(t("picker.searchProjects"), {
    autoFocus: true,
  });

  const project = useMemo(
    () => findProject(projects, projectId || null),
    [projects, projectId],
  );

  return (
    <ProjectPickerBody
      value={project ?? null}
      query={query}
      onChange={(next) => {
        if (sessionId) {
          setProject.mutate({ id: sessionId, projectId: next?.id ?? null });
        }
        router.back();
      }}
    />
  );
}
