/**
 * Label picker route for the in-progress new-issue draft — multi-select
 * with inline create, exactly like the issue-detail variant
 * (`issue/[id]/picker/label.tsx`) but writing to `useNewIssueDraftStore`
 * instead of attaching to a real issue (labels are carried into the create
 * payload as `label_ids`). The sheet stays open across toggles; the user
 * dismisses via the sheet grabber or the Back button.
 *
 * Search lives in the iOS native nav header when the sheet keeps its header
 * (registered in `_layout.tsx` with `headerShown: true` + title), and in the
 * body everywhere else — Android never renders the native search bar.
 */
import { useRef } from "react";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import { PickerBodyShell } from "@/components/pickers/picker-body-shell";
import { useCreateLabel } from "@/data/mutations/labels";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { usePickerSearch } from "@/lib/use-picker-search";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueLabelPickerRoute() {
  const { t } = useTranslation();
  const labels = useNewIssueDraftStore((s) => s.labels);
  const attachLabel = useNewIssueDraftStore((s) => s.attachLabel);
  const detachLabel = useNewIssueDraftStore((s) => s.detachLabel);
  const createLabel = useCreateLabel();
  const search = usePickerSearch(t("picker.searchLabels"), {
    autoFocus: true,
    nativeHeader: true,
  });

  // Synchronous lock to prevent double-submit on rapid taps on the Create
  // row before React state updates — mirrors web's `creatingRef` pattern in
  // `packages/views/issues/components/pickers/label-picker.tsx`.
  const creatingRef = useRef(false);

  return (
    <PickerBodyShell search={search} title={t("attr.labels")}>
      <LabelPickerBody
        attached={labels}
        query={search.query}
        onAttach={(label) => attachLabel(label)}
        onDetach={(labelId) => detachLabel(labelId)}
        onCreate={(name, color) => {
          if (creatingRef.current) return;
          creatingRef.current = true;
          createLabel.mutate(
            { name, color },
            {
              onSuccess: (label) => {
                attachLabel(label);
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
