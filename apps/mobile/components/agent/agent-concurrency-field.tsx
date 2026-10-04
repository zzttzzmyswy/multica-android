/**
 * Agent "Concurrency" property row — the mobile port of web's
 * `ConcurrencyField` (`packages/views/agents/components/agent-detail-inspector.tsx
 * :316-368`), which sits inside a `SettingsRow` labelled
 * `inspector.prop_concurrency` (`:300-309`).
 *
 * Web commits **immediately** (a PATCH per committed edit), not through the
 * edit form's draft — this field is deliberately outside `AgentDraft`
 * (`packages/core/agents/draft.ts` carries only name/description/instructions/
 * model/thinking_level/service_tier, and `buildUpdateAgentRequest` writes
 * exactly those). Mobile keeps that split: the row calls
 * `api.updateAgent(id, { max_concurrent_tasks })` directly.
 *
 * Commit semantics, reproduced from web's `commit` (`:330-340`):
 *   - non-integer, or outside [MIN, MAX] → **roll back to the current value**
 *     and send nothing. A silent clamp would leave the field showing one
 *     number and the agent holding another.
 *   - equal to the current value → no request at all.
 *   - otherwise → PATCH, and the parent's optimistic update is what moves the
 *     displayed value.
 *
 * The range is read from `AGENT_MAX_CONCURRENT_TASKS_MIN` / `_MAX`
 * (`packages/core/agents/constants.ts:8-9`) rather than literals, so the
 * field, the hint text and the backend's own validation cannot drift apart.
 */
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
  AGENT_MAX_CONCURRENT_TASKS_MAX,
  AGENT_MAX_CONCURRENT_TASKS_MIN,
} from "@multica/core/agents";
import { resolveConcurrencyCommit } from "@/lib/agent-concurrency";
import { Text } from "@/components/ui/text";
import { TextField } from "@/components/ui/text-field";
import { useTranslation } from "@/lib/i18n/react";

export function AgentConcurrencyField({
  value,
  canEdit,
  saving,
  onSave,
}: {
  value: number;
  canEdit: boolean;
  saving: boolean;
  onSave: (next: number) => void;
}) {
  const { t } = useTranslation();
  // Seeded from the server value and re-seeded whenever it changes, so an
  // optimistic patch (or a rollback) is what the field shows — web's
  // `useEffect(() => setDraft(String(value)), [value])`.
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);

  const commit = () => {
    const next = resolveConcurrencyCommit(draft, value);
    if (next === null) {
      setDraft(String(value));
      return;
    }
    onSave(next);
  };

  return (
    <View className="gap-1">
      <TextField
        value={draft}
        onChangeText={setDraft}
        // `number-pad` is the closest RN equivalent of web's
        // `inputMode="numeric"`: digits only, no sign or decimal separator, so
        // a non-integer is hard to type in the first place (the commit guard
        // still covers a paste).
        keyboardType="number-pad"
        editable={canEdit && !saving}
        onBlur={commit}
        onSubmitEditing={commit}
        returnKeyType="done"
        accessibilityLabel={t("agents.detail.fieldConcurrency")}
        // Monospaced digits so the number does not jitter as it changes,
        // matching web's `font-mono tabular-nums`.
        className="h-9 font-mono tabular-nums"
      />
      <Text className="text-caption text-muted-foreground">
        {t("agents.detail.concurrencyRange", {
          min: AGENT_MAX_CONCURRENT_TASKS_MIN,
          max: AGENT_MAX_CONCURRENT_TASKS_MAX,
        })}
      </Text>
    </View>
  );
}
