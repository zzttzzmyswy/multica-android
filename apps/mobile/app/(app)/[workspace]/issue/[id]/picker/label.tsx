/**
 * Label picker route for an existing issue — multi-select with inline
 * create (the sheet stays open across toggles; the user dismisses via the
 * sheet grabber or the Back button).
 *
 * The sheet inherits `SHEET_OPTIONS` (`headerShown: false`), so the native
 * search bar would not mount on either platform — search is body-rendered.
 */
import { useRef } from "react";
import { useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { issueDetailOptions } from "@/data/queries/issues";
import {
  useAttachLabel,
  useDetachLabel,
} from "@/data/mutations/issues";
import { useCreateLabel } from "@/data/mutations/labels";
import { useWorkspaceStore } from "@/data/workspace-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function IssueLabelPickerRoute() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { data: issue } = useQuery(issueDetailOptions(wsId, id));
  const attachLabel = useAttachLabel(id);
  const detachLabel = useDetachLabel(id);
  const createLabel = useCreateLabel();
  const search = usePickerSearch(t("picker.searchLabels"), { autoFocus: true });

  // Synchronous lock to prevent double-submit on rapid taps on the Create
  // row before React state updates — mirrors web's `creatingRef` pattern in
  // `packages/views/issues/components/pickers/label-picker.tsx`.
  const creatingRef = useRef(false);

  const attached = issue?.labels ?? [];

  return (
    <PickerBodyShell search={search} title={t("attr.labels")}>
      <LabelPickerBody
        attached={attached}
        query={search.query}
        onAttach={(label) => attachLabel.mutate({ label })}
        onDetach={(labelId) => detachLabel.mutate({ labelId })}
        onCreate={(name, color) => {
          if (creatingRef.current) return;
          creatingRef.current = true;
          createLabel.mutate(
            { name, color },
            {
              onSuccess: (label) => {
                attachLabel.mutate({ label });
              },
              onSettled: () => {
                creatingRef.current = false;
              },
            },
          );
        }}
      />
    </PickerBodyShell>
  );
}
