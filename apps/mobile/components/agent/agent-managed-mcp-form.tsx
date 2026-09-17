/**
 * Add/edit one of an agent's OWN MCP servers (mobile counterpart of web's
 * `McpServerDialog`, packages/views/agents/components/tabs/mcp-server-dialog.tsx)
 * rendered as a centred modal, since a phone has no room for a dialog with a
 * form/JSON tab strip.
 *
 * Field semantics are identical to web's guided form — and to mobile's
 * `components/mcp/mcp-server-form.tsx`, which does the same job for the
 * workspace library — because both write the same `config` document; the
 * mapping lives in `lib/mcp-config.ts`.
 *
 * Difference from the workspace form: an agent's own config is READABLE, so
 * edit mode seeds the real values instead of opening blank behind a
 * write-only banner. That means the name IS editable here and a rename is a
 * move (see `upsertManagedMcpServer`).
 *
 * The JSON tab web offers for transports the guided form cannot express
 * (sse/unknown, or an entry living under the legacy `mcp` container) is not
 * shipped: mobile hides those entries behind a read-only "not form-editable"
 * marker rather than risk rewriting them through a lossy form.
 */
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  configFromForm,
  formFromConfig,
  type ManagedMcpServer,
  type McpFormState,
  type McpKeyValue,
  type McpFormTransport,
} from "@/lib/mcp-config";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

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
  const [form, setForm] = useState<McpFormState>({
    transport: "stdio",
    command: "",
    argsText: "",
    env: [],
    url: "",
    headers: [],
  });
  const [showErrors, setShowErrors] = useState(false);

  // Re-seed on every open: the modal is reused across add/edit, and a stale
  // form would save the previous entry's fields onto this one.
  useEffect(() => {
    if (!visible) return;
    setShowErrors(false);
    if (server) {
      setName(server.name);
      setForm(formFromConfig(server.config));
    } else {
      setName("");
      setForm({
        transport: "stdio",
        command: "",
        argsText: "",
        env: [],
        url: "",
        headers: [],
      });
    }
  }, [visible, server]);

  const trimmedName = name.trim();
  const nameMissing = trimmedName.length === 0;
  const nameFormatInvalid = !nameMissing && !NAME_PATTERN.test(trimmedName);
  const nameDuplicate =
    !nameMissing &&
    !nameFormatInvalid &&
    existingNames.some((n) => n === trimmedName && n !== server?.name);
  const commandMissing = form.transport === "stdio" && form.command.trim() === "";
  const urlMissing = form.transport === "http" && form.url.trim() === "";

  // Validation runs on press rather than gating the button, so a failure
  // always explains itself instead of leaving a dead control.
  const handleSave = () => {
    setShowErrors(true);
    if (
      nameMissing ||
      nameFormatInvalid ||
      nameDuplicate ||
      commandMissing ||
      urlMissing
    ) {
      return;
    }
    onSave(trimmedName, configFromForm(form));
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
                    invalid={
                      showErrors &&
                      (nameMissing || nameFormatInvalid || nameDuplicate)
                    }
                    editable={!saving}
                    autoCapitalize="none"
                    autoCorrect={false}
                    autoFocus={!server}
                    maxLength={120}
                  />
                  {showErrors && nameMissing ? (
                    <FieldError text={t("mcp.form.nameRequired")} />
                  ) : null}
                  {showErrors && !nameMissing && nameFormatInvalid ? (
                    <FieldError text={t("mcp.form.nameInvalid")} />
                  ) : null}
                  {showErrors &&
                  !nameMissing &&
                  !nameFormatInvalid &&
                  nameDuplicate ? (
                    <FieldError text={t("mcp.form.nameDuplicate")} />
                  ) : null}
                </View>

                {/* Transport */}
                <View className="gap-2">
                  <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {t("mcp.form.transport")}
                  </Text>
                  <View className="flex-row gap-2">
                    {(["stdio", "http"] as const).map((option: McpFormTransport) => (
                      <Pressable
                        key={option}
                        accessibilityRole="button"
                        accessibilityState={{ selected: form.transport === option }}
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
                    ))}
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
                        invalid={showErrors && commandMissing}
                        editable={!saving}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {showErrors && commandMissing ? (
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
                        onChangeText={(v) => setForm((f) => ({ ...f, url: v }))}
                        placeholder={t("mcp.form.urlPlaceholder")}
                        invalid={showErrors && urlMissing}
                        editable={!saving}
                        autoCapitalize="none"
                        autoCorrect={false}
                        keyboardType="url"
                      />
                      {showErrors && urlMissing ? (
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
