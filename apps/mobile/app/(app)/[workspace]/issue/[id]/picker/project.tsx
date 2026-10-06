/**
 * Project picker route for an existing issue. The sheet inherits
 * `SHEET_OPTIONS` (`headerShown: false`), so the native search bar would not
 * mount on either platform — search is body-rendered.
 */
import { useMemo } from "react";
import { useLocalSearchParams, router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { ProjectPickerBody } from "@/components/issue/pickers/project-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { issueDetailOptions } from "@/data/queries/issues";
import { findProject, projectListOptions } from "@/data/queries/projects";
import { useUpdateIssue } from "@/data/mutations/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueProjectPickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const { data: projects = [] } = useQuery(projectListOptions(wsId));
  const updateIssue = useUpdateIssue(id);
  const search = usePickerSearch(t("picker.searchProjects"), {
    autoFocus: true,
  });

  const project = useMemo(
    () => findProject(projects, issue?.project_id ?? null),
    [projects, issue?.project_id],
  );

  return (
    <PickerBodyShell search={search} title={t("attr.project")}>
      <ProjectPickerBody
        value={project ?? null}
        query={search.query}
        onChange={(next) => {
          updateIssue.mutate({ project_id: next?.id ?? null });
          router.back();
        }}
      />
    </PickerBodyShell>
  );
}
