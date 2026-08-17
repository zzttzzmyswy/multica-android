/**
 * Label picker route for the in-progress new-issue draft — multi-select
 * with inline create, exactly like the issue-detail variant
 * (`issue/[id]/picker/label.tsx`) but writing to `useNewIssueDraftStore`
 * instead of attaching to a real issue (labels are carried into the create
 * payload as `label_ids`).
 *
 * Native search bar registered via the route's Stack.Screen options in
 * `_layout.tsx` (`headerShown` + title) + `useNativeSearchBar`. The sheet
 * stays open across toggles; the user dismisses via the sheet grabber or
 * the Back button.
 */
import { useRef } from "react";
import { LabelPickerBody } from "@/components/issue/pickers/label-picker-body";
import { useCreateLabel } from "@/data/mutations/labels";
import { useNewIssueDraftStore } from "@/data/stores/new-issue-draft-store";
import { useNativeSearchBar } from "@/lib/use-native-search-bar";
import { useTranslation } from "@/lib/i18n/react";

export default function NewIssueLabelPickerRoute() {
  const { t } = useTranslation();
  const labels = useNewIssueDraftStore((s) => s.labels);
  const attachLabel = useNewIssueDraftStore((s) => s.attachLabel);
  const detachLabel = useNewIssueDraftStore((s) => s.detachLabel);
  const createLabel = useCreateLabel();
  const query = useNativeSearchBar(t("picker.searchLabels"), { autoFocus: true });

  // Synchronous lock to prevent double-submit on rapid taps on the Create
  // row before React state updates — mirrors web's `creatingRef` pattern in
  // `packages/views/issues/components/pickers/label-picker.tsx`.
  const creatingRef = useRef(false);

  return (
    <LabelPickerBody
      attached={labels}
      query={query}
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
  );
}