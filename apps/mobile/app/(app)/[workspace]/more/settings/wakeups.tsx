/**
 * Settings → Wakeups (MYS-2043) — the platform rule's WORKSPACE default.
 *
 * Mirrors web `packages/views/settings/components/wakeups-tab.tsx` (145 lines):
 * one card for the child-done rule, holding an on-by-default switch and the
 * instruction every issue inherits unless it set its own. Web hangs this off
 * the settings page's Tabs; mobile's settings page is a list of push screens,
 * so it is one more `NavRow` that lands here.
 *
 * Why this exists: the wakeup subsystem's two WORKSPACE-level homes were both
 * at zero on mobile. A phone user could see and edit the rule on an individual
 * issue (MYS-2023 / MYS-2031 / MYS-2040) but had no way to learn — let alone
 * change — the default that every other issue follows. The issue-level
 * section even says so on screen ("工作区默认关闭，可在 设置 → 唤醒 中修改默认
 * 值"), naming a screen that did not exist.
 *
 * Three deliberate differences from web:
 *
 *   1. **`canManage` gates the controls, not just the copy.** Web disables the
 *      switch and the textarea for a non-admin and prints `admin_only`
 *      underneath. Same here — and the gate is `canManageRole` (owner || admin,
 *      `lib/member-guards.ts`), the same tier the server enforces
 *      (`issue_system_wakeup.go:305-308` answers 403 below it).
 *
 *   2. **The byte cap is enforced as you type, in BYTES.** Web checks 4,000
 *      bytes on submit via `new TextEncoder()`. A phone keyboard plus a Chinese
 *      instruction makes the over-limit case the common one, so the count is
 *      shown live and the submit refuses with the field marked — the same
 *      contract `wakeupSystemInstructionErrorKey` already implements for the
 *      per-issue form. Reusing that function rather than re-deriving the limit
 *      is the point: the two surfaces share one server ceiling.
 *
 *   3. **A save is explicit.** Web saves the instruction on form submit and the
 *      SWITCH immediately on toggle (two calls to one hook, each sending only
 *      the field it changed, because the endpoint keeps omitted fields). This
 *      keeps exactly that split — an explicit Save for the text, an immediate
 *      write for the switch — because a switch that needed a Save tap would
 *      read as broken, and a textarea that saved per keystroke would send 40
 *      writes for one sentence.
 *
 * The draft is NOT optimistic: `useUpdateWorkspaceSystemWakeup` seeds the
 * endpoint's own response into the cache, so what the screen shows after a save
 * is the server's value, not the string that was typed.
 */
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import type { WorkspaceSystemWakeup } from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { Separator } from "@/components/ui/separator";
import { workspaceSystemWakeupsOptions } from "@/data/queries/workspace-wakeups";
import { useUpdateWorkspaceSystemWakeup } from "@/data/mutations/workspace-wakeups";
import { useCurrentMemberRole } from "@/data/use-current-member-role";
import { useWorkspaceStore } from "@/data/workspace-store";
import { canManageRole } from "@/lib/member-guards";
import {
  WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES,
  wakeupSystemInstructionErrorKey,
  utf8ByteLength,
} from "@/lib/wakeup-controls";
import { useTranslation } from "@/lib/i18n/react";

export default function WakeupsSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const { t } = useTranslation();
  const { role } = useCurrentMemberRole();
  const canManage = canManageRole(role);
  const { data: rules, isLoading, isError, refetch } = useQuery(
    workspaceSystemWakeupsOptions(wsId),
  );
  // The only platform rule today. `find` rather than `[0]`: the endpoint
  // returns a list, and reading it positionally would silently show the wrong
  // rule the day a second one exists.
  const childDone = (rules ?? []).find((rule) => rule.rule === "child_done");

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
    >
      <Stack.Screen options={{ title: t("settings.wakeups.title") }} />

      <Text className="text-body text-muted-foreground px-1">
        {t("settings.wakeups.description")}
      </Text>

      {isLoading ? (
        <View className="py-8 items-center">
          <ActivityIndicator />
        </View>
      ) : isError ? (
        // An unresolved read must not render as "this workspace has no
        // defaults" — the absence-claim defect this fork has closed
        // repeatedly. It says the read failed and offers a retry.
        <View className="gap-3">
          <Text className="text-body text-destructive">
            {t("settings.wakeups.load_error")}
          </Text>
          <Button variant="outline" onPress={() => void refetch()}>
            <Text>{t("workspace.retry")}</Text>
          </Button>
        </View>
      ) : childDone ? (
        <ChildDoneDefault rule={childDone} canManage={canManage} />
      ) : (
        // A successful read with no child_done row: the server has not
        // materialized the rule in this workspace yet. Stated as such rather
        // than drawn as an empty card with dead controls.
        <Text className="text-body text-muted-foreground">
          {t("settings.wakeups.empty")}
        </Text>
      )}

      {!canManage && childDone && !isLoading && !isError ? (
        <Text className="text-caption text-muted-foreground px-1">
          {t("settings.wakeups.admin_only")}
        </Text>
      ) : null}

      <View className="h-8" />
    </ScrollView>
  );
}

/**
 * The child-done rule's workspace default.
 *
 * Split out so the draft's state unmounts with the rule it belongs to: a
 * `useState` seeded from `rule.instruction` that stayed mounted across a
 * refetch would keep the user's text after the server moved underneath it.
 */
function ChildDoneDefault({
  rule,
  canManage,
}: {
  rule: WorkspaceSystemWakeup;
  canManage: boolean;
}) {
  const { t } = useTranslation();
  const update = useUpdateWorkspaceSystemWakeup();
  const [instruction, setInstruction] = useState(rule.instruction);
  const [errorKey, setErrorKey] = useState<string | null>(null);

  // A save from another device (or another admin) replaces an UNTOUCHED draft.
  // A dirty draft is deliberately left alone: overwriting text the user is
  // mid-sentence on is worse than showing a value that is a moment stale, and
  // the Save button's own write is what reconciles it.
  useEffect(() => {
    setInstruction(rule.instruction);
  }, [rule.instruction]);

  const dirty = instruction.trim() !== rule.instruction;
  const bytes = utf8ByteLength(instruction.trim());

  const save = (input: { enabled?: boolean; instruction?: string }) => {
    update.mutate({ rule: rule.rule, ...input });
  };

  const submitInstruction = () => {
    const next = instruction.trim();
    const invalid = wakeupSystemInstructionErrorKey(next);
    if (invalid) {
      setErrorKey(invalid);
      return;
    }
    setErrorKey(null);
    // Empty is VALID here and means "go back to the built-in instruction" —
    // the opposite of the per-issue form, whose empty value the server refuses.
    // `wakeupSystemInstructionErrorKey` encodes exactly that asymmetry.
    save({ instruction: next });
  };

  const busy = update.isPending;

  return (
    <View className="gap-2">
      <View className="px-1">
        <Text className="text-caption uppercase tracking-wider text-muted-foreground">
          {t("settings.wakeups.child_done_title")}
        </Text>
        <Text className="text-caption text-muted-foreground mt-1">
          {t("settings.wakeups.child_done_description")}
        </Text>
      </View>

      <View className="rounded-md border border-border bg-card overflow-hidden">
        <View className="flex-row items-center px-4 py-3.5 gap-3">
          <View className="flex-1">
            <Text className="text-title-sm font-medium text-foreground">
              {t("settings.wakeups.enabled")}
            </Text>
            {rule.customized > 0 ? (
              <Text className="text-caption text-muted-foreground mt-0.5">
                {t("settings.wakeups.customized", { count: rule.customized })}
              </Text>
            ) : null}
          </View>
          <Switch
            checked={rule.enabled}
            disabled={!canManage || busy}
            accessibilityLabel={t("settings.wakeups.enabled")}
            // Only `enabled` is sent: the endpoint keeps omitted fields, so
            // flipping the switch cannot clobber an instruction someone else
            // just saved.
            onCheckedChange={(enabled) => save({ enabled })}
          />
        </View>

        <Separator />

        <View className="px-4 py-3.5 gap-2">
          <Text className="text-title-sm font-medium text-foreground">
            {t("settings.wakeups.instruction")}
          </Text>
          <Text className="text-caption leading-5 text-muted-foreground">
            {t("settings.wakeups.instruction_hint")}
          </Text>
          <AutosizeTextArea
            value={instruction}
            onChangeText={(text) => {
              setInstruction(text);
              setErrorKey(null);
            }}
            editable={canManage && !busy}
            placeholder={t("settings.wakeups.instruction_placeholder")}
            accessibilityLabel={t("settings.wakeups.instruction")}
          />
          {errorKey ? (
            <Text className="text-caption text-destructive" accessibilityRole="alert">
              {t(errorKey)}
            </Text>
          ) : null}
          {/* The limit is shown live once the draft passes half of it: below
              that the number is noise, above it the user is about to be
              refused and needs to see why. */}
          {bytes > WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES / 2 ? (
            <Text className="text-caption tabular-nums text-muted-foreground self-end">
              {t("settings.wakeups.bytes", {
                bytes,
                max: WAKEUP_SYSTEM_INSTRUCTION_MAX_BYTES,
              })}
            </Text>
          ) : null}
          {canManage ? (
            <View className="flex-row justify-end">
              <Button
                onPress={submitInstruction}
                disabled={!dirty || busy}
              >
                <Text>
                  {busy
                    ? t("settings.wakeups.saving")
                    : t("settings.wakeups.save")}
                </Text>
              </Button>
            </View>
          ) : null}
        </View>

        {rule.builtin_instruction ? (
          <View className="border-t border-border bg-secondary/40 px-4 py-3 gap-1">
            <Text className="text-caption font-medium text-muted-foreground">
              {t("settings.wakeups.builtin")}
            </Text>
            <Text className="text-caption leading-5 text-muted-foreground">
              {rule.builtin_instruction}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}
