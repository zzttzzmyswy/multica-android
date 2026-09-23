/**
 * Add/edit one of an agent's OWN MCP servers (mobile counterpart of web's
 * `McpServerDialog`, packages/views/agents/components/tabs/mcp-server-dialog.tsx)
 * rendered as a centred modal, since a phone has no room for a dialog with a
 * form/JSON tab strip.
 *
 * Field semantics are identical to web's guided form — and to mobile's
 * `components/mcp/mcp-server-form.tsx`, which does the same job for the
 * workspace library — because both write the same `config` document through
 * the shared editor in `lib/mcp-config.ts` and `components/mcp/mcp-editor.tsx`.
 *
 * Difference from the workspace form: an agent's own config is READABLE, so
 * edit mode seeds the real values instead of opening blank behind a
 * write-only banner. That means the name IS editable here and a rename is a
 * move (see `upsertManagedMcpServer`).
 *
 * Both editors are offered. An entry the guided form cannot represent —
 * `sse`/unknown transport, or one living under the legacy `mcp` container —
 * opens in the JSON editor with the form tab disabled, so editing it cannot
 * silently rewrite its protocol.
 */
import { useEffect, useMemo, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  McpEditorTabs,
  McpJsonField,
  mcpEditorErrorMessage,
} from "@/components/mcp/mcp-editor";
import {
  emptyMcpForm,
  formSupportsServer,
  mcpEditorConfig,
  mcpEditorSeed,
  mcpFormError,
  mcpNameError,
  parseServerJson,
  switchMcpEditorMode,
  type ManagedMcpServer,
  type McpEditorMode,
  type McpFormState,
  type McpKeyValue,
  type McpFormTransport,
} from "@/lib/mcp-config";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}

export function AgentManagedMcpForm({
  visible,
  server,
  existingNames,
  saving,
  onSave,
  onClose,
}: {
  visible: boolean;
  /** Present → edit that entry; absent → add a new one. */
  server: ManagedMcpServer | null;
  /** Names already on the agent; a duplicate is rejected before the round-trip. */
  existingNames: string[];
  saving: boolean;
  onSave: (name: string, config: Record<string, unknown>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const [name, setName] = useState("");
  const [mode, setMode] = useState<McpEditorMode>("form");
  const [form, setForm] = useState<McpFormState>(emptyMcpForm);
  const [jsonText, setJsonText] = useState("{}");
  const [showErrors, setShowErrors] = useState(false);

  // Re-seed on every open: the modal is reused across add/edit, and a stale
  // form would save the previous entry's fields onto this one.
  useEffect(() => {
    if (!visible) return;
    const seed = mcpEditorSeed(server);
    setShowErrors(false);
    setName(seed.name);
    setMode(seed.mode);
    setForm(seed.form);
    setJsonText(seed.jsonText);
  }, [visible, server]);

  const formAvailable = !server || formSupportsServer(server);
  const jsonResult = useMemo(() => parseServerJson(jsonText), [jsonText]);
  const trimmedName = name.trim();
  const nameError = mcpNameError(name, existingNames, server?.name);
  const formError = mcpFormError(form);

  const errorText = mcpEditorErrorMessage(t, {
    nameError,
    formError,
    mode,
    jsonResult,
  });

  const handleModeChange = (next: McpEditorMode) => {
    if (next === "form" && !formAvailable) return;
    const carried = switchMcpEditorMode({
      to: next,
      mode,
      form,
      jsonText,
      jsonResult,
    });
    setMode(carried.mode);
    setForm(carried.form);
    setJsonText(carried.jsonText);
  };

  // Validation runs on press rather than gating the button, so a failure
  // always explains itself instead of leaving a dead control.
  const handleSave = () => {
    setShowErrors(true);
    const config = mcpEditorConfig(mode, form, jsonResult);
    if (nameError !== null || !config) return;
    onSave(trimmedName, config);
  };

  const setEnvAt = (index: number, patch: Partial<McpKeyValue>) =>
    setForm((f) => ({
      ...f,
      env: f.env.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));
  const setHeadersAt = (index: number, patch: Partial<McpKeyValue>) =>
    setForm((f) => ({
      ...f,
      headers: f.headers.map((row, i) => (i === index ? { ...row, ...patch } : row)),
    }));

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={saving ? undefined : onClose}
    >
      <Pressable
        className="flex-1 bg-black/40"
        onPress={saving ? undefined : onClose}
      >
        <KeyboardAvoidingView
          className="flex-1 items-center justify-center px-5"
          behavior={keyboardBehavior}
        >
          <Pressable onPress={() => {}} className="w-full max-w-md">
            <View className="bg-popover rounded-2xl overflow-hidden">
              <View className="px-4 pt-4 pb-2">
                <Text className="text-base font-semibold text-foreground">
                  {server
                    ? t("mcp.form.editTitle")
                    : t("mcp.form.createTitle")}
                </Text>
              </View>
              <ScrollView
                className="max-h-[70vh]"
                contentContainerClassName="px-4 pb-4 gap-4"
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
              >
                {/* Name */}
                <View className="gap-1.5">
                  <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("mcp.form.name")}
                  </Text>
                  <TextField
                    value={name}
                    onChangeText={setName}
                    placeholder={t("mcp.form.namePlaceholder")}
                    invalid={showErrors && nameError !== null}
                    editable={!saving}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus={!server}
                    maxLength={120}
                  />
                  {showErrors && nameError === "required" ? (
                    <FieldError text={t("mcp.form.nameRequired")} />
                  ) : null}
                  {showErrors && nameError === "format" ? (
                    <FieldError text={t("mcp.form.nameInvalid")} />
                  ) : null}
                  {showErrors && nameError === "duplicate" ? (
                    <FieldError text={t("mcp.form.nameDuplicate")} />
                  ) : null}
                </View>

                <McpEditorTabs
                  mode={mode}
                  formAvailable={formAvailable}
                  onChange={handleModeChange}
                />

                {mode === "json" ? (
                  <McpJsonField
                    value={jsonText}
                    onChange={setJsonText}
                    invalid={jsonResult.ok === false}
                    editable={!saving}
                    hint={
                      server?.container === "mcp"
                        ? t("mcp.form.nativeJsonHint")
                        : undefined
                    }
                  />
                ) : (
                  <>
                    {/* Transport */}
                    <View className="gap-2">
                      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {t("mcp.form.transport")}
                      </Text>
                      <View className="flex-row gap-2">
                        {(["stdio", "http"] as const).map(
                          (option: McpFormTransport) => (
                            <Pressable
                              key={option}
                              accessibilityRole="button"
                              accessibilityState={{
                                selected: form.transport === option,
                              }}
                              onPress={() =>
                                setForm((f) => ({ ...f, transport: option }))
                              }
                              disabled={saving}
                              className={cn(
                                "flex-1 items-center rounded-md border px-3 py-2.5",
                                form.transport === option
                                  ? "border-brand bg-brand/10"
                                  : "border-border bg-secondary/50",
                              )}
                            >
                              <Text
                                className={cn(
                                  "text-sm font-medium",
                                  form.transport === option
                                    ? "text-brand"
                                    : "text-foreground",
                                )}
                              >
                                {option === "stdio"
                                  ? t("mcp.form.typeStdio")
                                  : t("mcp.form.typeHttp")}
                              </Text>
                            </Pressable>
                          ),
                        )}
                      </View>
                    </View>

                    {form.transport === "stdio" ? (
                      <>
                        <View className="gap-1.5">
                          <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t("mcp.form.command")}
                          </Text>
                          <TextField
                            value={form.command}
                            onChangeText={(v) =>
                              setForm((f) => ({ ...f, command: v }))
                            }
                            placeholder={t("mcp.form.commandPlaceholder")}
                            invalid={showErrors && formError === "command"}
                            editable={!saving}
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                          {showErrors && formError === "command" ? (
                            <FieldError text={t("mcp.form.commandRequired")} />
                          ) : null}
                        </View>

                        <View className="gap-1.5">
                          <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t("mcp.form.args")}
                          </Text>
                          <TextField
                            value={form.argsText}
                            onChangeText={(v) =>
                              setForm((f) => ({ ...f, argsText: v }))
                            }
                            placeholder={t("mcp.form.argsPlaceholder")}
                            editable={!saving}
                            autoCapitalize="none"
                            autoCorrect={false}
                          />
                          <Text className="text-[11px] text-muted-foreground/70">
                            {t("mcp.form.argsHint")}
                          </Text>
                        </View>

                        <KeyValueRows
                          label={t("mcp.form.env")}
                          rows={form.env}
                          disabled={saving}
                          theme={theme}
                          onAdd={() =>
                            setForm((f) => ({
                              ...f,
                              env: [...f.env, { key: "", value: "" }],
                            }))
                          }
                          onChangeAt={setEnvAt}
                          onRemoveAt={(index) =>
                            setForm((f) => ({
                              ...f,
                              env: f.env.filter((_, i) => i !== index),
                            }))
                          }
                          t={t}
                        />
                      </>
                    ) : (
                      <>
                        <View className="gap-1.5">
                          <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                            {t("mcp.form.url")}
                          </Text>
                          <TextField
                            value={form.url}
                            onChangeText={(v) =>
                              setForm((f) => ({ ...f, url: v }))
                            }
                            placeholder={t("mcp.form.urlPlaceholder")}
                            invalid={showErrors && formError === "url"}
                            editable={!saving}
                            autoCapitalize="none"
                            autoCorrect={false}
                            keyboardType="url"
                          />
                          {showErrors && formError === "url" ? (
                            <FieldError text={t("mcp.form.urlRequired")} />
                          ) : null}
                        </View>

                        <KeyValueRows
                          label={t("mcp.form.headers")}
                          rows={form.headers}
                          disabled={saving}
                          theme={theme}
                          onAdd={() =>
                            setForm((f) => ({
                              ...f,
                              headers: [...f.headers, { key: "", value: "" }],
                            }))
                          }
                          onChangeAt={setHeadersAt}
                          onRemoveAt={(index) =>
                            setForm((f) => ({
                              ...f,
                              headers: f.headers.filter((_, i) => i !== index),
                            }))
                          }
                          t={t}
                        />
                      </>
                    )}
                  </>
                )}

                {showErrors && errorText ? (
                  <Text className="text-xs text-destructive">{errorText}</Text>
                ) : null}
              </ScrollView>

              <View className="flex-row justify-end gap-2 border-t border-border px-4 py-3">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={saving}
                  onPress={onClose}
                >
                  <Text>{t("mcp.cancel")}</Text>
                </Button>
                <Button
                  size="sm"
                  disabled={saving}
                  onPress={handleSave}
                >
                  <Text>
                    {saving ? t("mcp.form.saving") : t("mcp.form.save")}
                  </Text>
                </Button>
              </View>
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

function KeyValueRows({
  label,
  rows,
  disabled,
  theme,
  onAdd,
  onChangeAt,
  onRemoveAt,
  t,
}: {
  label: string;
  rows: McpKeyValue[];
  disabled: boolean;
  theme: (typeof THEME)["light"];
  onAdd: () => void;
  onChangeAt: (index: number, patch: Partial<McpKeyValue>) => void;
  onRemoveAt: (index: number) => void;
  t: (id: string, params?: Record<string, string | number>) => string;
}) {
  return (
    <View className="gap-1.5">
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </Text>
      {rows.map((row, index) => (
        <View key={index} className="flex-row items-center gap-2">
          <TextField
            value={row.key}
            onChangeText={(v) => onChangeAt(index, { key: v })}
            placeholder={t("mcp.form.key")}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1"
          />
          <TextField
            value={row.value}
            onChangeText={(v) => onChangeAt(index, { value: v })}
            placeholder={t("mcp.form.value")}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
            className="flex-1"
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("mcp.form.removeRow")}
            disabled={disabled}
            onPress={() => onRemoveAt(index)}
            className="p-1"
          >
            <Text style={{ color: theme.mutedForeground }}>✕</Text>
          </Pressable>
        </View>
      ))}
      <Pressable
        accessibilityRole="button"
        disabled={disabled}
        onPress={onAdd}
        className="self-start py-1"
      >
        <Text className="text-xs text-brand">{t("mcp.form.addRow")}</Text>
      </Pressable>
    </View>
  );
}
