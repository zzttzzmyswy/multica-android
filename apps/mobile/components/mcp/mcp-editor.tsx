/**
 * The form/JSON editor chrome shared by both MCP surfaces — the workspace
 * library form (`components/mcp/mcp-server-form.tsx`) and the agent-side
 * modal (`components/agent/agent-managed-mcp-form.tsx`). They differ only in
 * their outer chrome (a push screen versus a modal) and in how they seed
 * their state; the editor itself is the same, so it lives here rather than
 * being written twice and drifting.
 *
 * Mirrors web's `McpServerDialog` tab strip
 * (packages/views/agents/components/tabs/mcp-server-dialog.tsx): a two-way
 * Form / JSON switch where the Form tab is DISABLED — not merely unselected —
 * for an entry the guided form cannot represent, because switching to it
 * would rewrite the entry's transport.
 */
import { View } from "react-native";
import { Text } from "@/components/ui/text";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { useTranslation } from "@/lib/i18n/react";
import type { McpEditorMode, McpJsonParseResult } from "@/lib/mcp-config";

/** Form / JSON switch. `formAvailable` false renders the Form tab inert. */
export function McpEditorTabs({
  mode,
  formAvailable,
  onChange,
}: {
  mode: McpEditorMode;
  formAvailable: boolean;
  onChange: (mode: McpEditorMode) => void;
}) {
  const { t } = useTranslation();
  return (
    <SegmentedControl
      value={mode}
      onChange={onChange}
      options={[
        {
          value: "form",
          label: t("mcp.form.modeForm"),
          disabled: !formAvailable,
        },
        { value: "json", label: t("mcp.form.modeJson") },
      ]}
    />
  );
}

/**
 * The JSON tab's body: a monospaced editor sized for a real config document.
 * `invalid` tints the field but never blocks typing — the message below says
 * what is wrong, and a half-typed document is the normal state while editing.
 */
export function McpJsonField({
  value,
  onChange,
  invalid,
  editable = true,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  invalid: boolean;
  editable?: boolean;
  /** Extra line above the field — the legacy-container note, when it applies. */
  hint?: string;
}) {
  const { t } = useTranslation();
  return (
    <View className="gap-1.5">
      {hint ? (
        <Text className="text-xs text-muted-foreground leading-5">{hint}</Text>
      ) : null}
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {t("mcp.form.jsonLabel")}
      </Text>
      <AutosizeTextArea
        value={value}
        onChangeText={onChange}
        editable={editable}
        minHeight={160}
        maxHeight={320}
        autoCapitalize="none"
        autoCorrect={false}
        spellCheck={false}
        accessibilityLabel={t("mcp.form.jsonAria")}
        className={
          invalid
            ? "rounded-md border border-destructive/60 bg-destructive/10 px-3 py-2 font-mono text-sm"
            : "rounded-md border border-border bg-secondary/50 px-3 py-2 font-mono text-sm"
        }
      />
      <Text className="text-[11px] text-muted-foreground/70">
        {t("mcp.form.jsonHint")}
      </Text>
    </View>
  );
}

/**
 * The one error line under the editor, in web's precedence order: the name
 * first (it is the field that decides create-vs-rename), then the active
 * editor's own complaint. Returns "" when nothing is wrong.
 */
export function mcpEditorErrorMessage(
  t: (id: string, params?: Record<string, string | number>) => string,
  {
    nameError,
    formError,
    mode,
    jsonResult,
  }: {
    nameError: "required" | "format" | "duplicate" | null;
    formError: "command" | "url" | null;
    mode: McpEditorMode;
    jsonResult: McpJsonParseResult;
  },
): string {
  if (nameError === "required") return t("mcp.form.nameRequired");
  if (nameError === "format") return t("mcp.form.nameInvalid");
  if (nameError === "duplicate") return t("mcp.form.nameDuplicate");
  if (mode === "form") {
    if (formError === "command") return t("mcp.form.commandRequired");
    if (formError === "url") return t("mcp.form.urlRequired");
    return "";
  }
  if (jsonResult.ok) return "";
  if (jsonResult.error === "not_object") return t("mcp.form.jsonNotObject");
  if (jsonResult.error === "missing_target") return t("mcp.form.jsonMissingTarget");
  return t("mcp.form.jsonInvalid", { error: jsonResult.error });
}
