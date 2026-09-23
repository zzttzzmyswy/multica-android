/**
 * Shared MCP server create/edit form (mobile mirror of web's
 * mcp-server-dialog.tsx).
 *
 * Workspace library entries are WRITE-ONLY: the API returns name + transport
 * but never the stored config, so editing re-supplies the configuration. In
 * edit mode (`server` present) the name is kept and the form opens on the
 * summary transport; every field starts empty — the banner says so instead
 * of pretending the empty form is the saved state.
 *
 * Two editors, as on web. The guided form expresses exactly two transports
 * (stdio / http) and saving from it REWRITES the entry, so an entry whose
 * summary transport is anything else (sse/unknown) opens straight in the JSON
 * editor with the form tab disabled — routing it through the form would
 * silently change its protocol. Every entry is editable: the JSON path is what
 * makes that safe.
 */
import { useCallback, useMemo, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  McpEditorTabs,
  McpJsonField,
  mcpEditorErrorMessage,
} from "@/components/mcp/mcp-editor";
import {
  formSupportsServer,
  mcpEditorConfig,
  mcpEditorSeed,
  mcpFormError,
  mcpNameError,
  parseServerJson,
  switchMcpEditorMode,
  type McpEditorMode,
  type McpFormState,
  type McpKeyValue,
} from "@/lib/mcp-config";
import {
  useCreateWorkspaceMcpServer,
  useUpdateWorkspaceMcpServer,
} from "@/data/mutations/mcp";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export interface McpServerFormServer {
  id: string;
  name: string;
  transport: string;
}

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}

export function McpServerForm({
  server,
  existingNames = [],
  onDone,
}: {
  /** Present → edit mode (write-only: fields re-supplied, transport seeded).
   *  Absent → create mode. */
  server?: McpServerFormServer | null;
  /** Names already in the library; duplicate names are rejected (web parity).
   *  Edit mode excludes the server's own name via `server.name`. */
  existingNames?: string[];
  onDone?: () => void;
}) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];
  const editing = !!server;

  // The library cannot read a saved config back, so the seed carries only the
  // summary transport (see `mcpEditorSeed`).
  const seed = useMemo(
    () => mcpEditorSeed(server ? { name: server.name, transport: server.transport } : null),
    [server],
  );
  const [name, setName] = useState(seed.name);
  const [mode, setMode] = useState<McpEditorMode>(seed.mode);
  const [form, setForm] = useState<McpFormState>(seed.form);
  const [jsonText, setJsonText] = useState(seed.jsonText);
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateWorkspaceMcpServer();
  const update = useUpdateWorkspaceMcpServer();
  const isSubmitting = create.isPending || update.isPending;

  // The form is unavailable — not merely unselected — for an entry it cannot
  // represent, so switching to it cannot rewrite that entry either.
  const formAvailable = !server || formSupportsServer({ ...server });

  const jsonResult = useMemo(() => parseServerJson(jsonText), [jsonText]);
  const trimmedName = name.trim();
  const nameError = mcpNameError(name, existingNames, server?.name);
  const formError = mcpFormError(form);

  const canSave =
    !isSubmitting &&
    nameError === null &&
    (mode === "form" ? formError === null : jsonResult.ok);

  const errorText = mcpEditorErrorMessage(t, {
    nameError,
    formError,
    mode,
    jsonResult,
  });

  const handleModeChange = useCallback(
    (next: McpEditorMode) => {
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
    },
    [mode, form, jsonText, jsonResult, formAvailable],
  );

  const handleSave = useCallback(async () => {
    if (isSubmitting) return;
    const config = mcpEditorConfig(mode, form, jsonResult);
    if (!canSave || !config) {
      setShowErrors(true);
      return;
    }
    try {
      if (editing && server) {
        await update.mutateAsync({
          serverId: server.id,
          update: { name: trimmedName, config },
        });
      } else {
        await create.mutateAsync({ name: trimmedName, config });
      }
      if (onDone) onDone();
      else router.back();
    } catch (err) {
      Alert.alert(
        t("mcp.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    canSave,
    mode,
    form,
    jsonResult,
    editing,
    server,
    trimmedName,
    update,
    create,
    onDone,
    t,
    isSubmitting,
  ]);

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
    <View className="px-4 pt-4 gap-5">
      {editing ? (
        <View className="rounded-md border border-border bg-muted/50 px-3 py-2.5">
          <Text className="text-xs text-muted-foreground leading-5">
            {t("mcp.writeOnlyNote")}
          </Text>
        </View>
      ) : null}

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
          editable={!isSubmitting}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!editing}
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

      {!formAvailable ? (
        <Text className="text-xs text-muted-foreground leading-5">
          {t("mcp.form.formUnavailable")}
        </Text>
      ) : null}

      {mode === "json" ? (
        <McpJsonField
          value={jsonText}
          onChange={setJsonText}
          invalid={jsonResult.ok === false}
          editable={!isSubmitting}
        />
      ) : (
        <>
          {/* Transport */}
          <View className="gap-2">
            <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("mcp.form.transport")}
            </Text>
            <View className="flex-row gap-2">
              {(["stdio", "http"] as const).map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.transport === option }}
                  onPress={() =>
                    setForm((f) => ({ ...f, transport: option }))
                  }
                  disabled={isSubmitting}
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
              {/* Command */}
              <View className="gap-1.5">
                <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("mcp.form.command")}
                </Text>
                <TextField
                  value={form.command}
                  onChangeText={(v) => setForm((f) => ({ ...f, command: v }))}
                  placeholder={t("mcp.form.commandPlaceholder")}
                  invalid={showErrors && formError === "command"}
                  editable={!isSubmitting}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                {showErrors && formError === "command" ? (
                  <FieldError text={t("mcp.form.commandRequired")} />
                ) : null}
              </View>

              {/* Args */}
              <View className="gap-1.5">
                <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("mcp.form.args")}
                </Text>
                <TextField
                  value={form.argsText}
                  onChangeText={(v) => setForm((f) => ({ ...f, argsText: v }))}
                  placeholder={t("mcp.form.argsPlaceholder")}
                  editable={!isSubmitting}
                  autoCapitalize="none"
                  autoCorrect={false}
                />
                <Text className="text-[11px] text-muted-foreground/70">
                  {t("mcp.form.argsHint")}
                </Text>
              </View>

              {/* Env */}
              <KeyValueRows
                label={t("mcp.form.env")}
                rows={form.env}
                keyPlaceholder={t("mcp.form.key")}
                valuePlaceholder={t("mcp.form.value")}
                addLabel={t("mcp.form.addRow")}
                removeAria={t("mcp.form.removeRow")}
                theme={theme}
                disabled={isSubmitting}
                onAdd={() =>
                  setForm((f) => ({ ...f, env: [...f.env, { key: "", value: "" }] }))
                }
                onChangeAt={setEnvAt}
                onRemoveAt={(index) =>
                  setForm((f) => ({
                    ...f,
                    env: f.env.filter((_, i) => i !== index),
                  }))
                }
              />
            </>
          ) : (
            <>
              {/* URL */}
              <View className="gap-1.5">
                <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                  {t("mcp.form.url")}
                </Text>
                <TextField
                  value={form.url}
                  onChangeText={(v) => setForm((f) => ({ ...f, url: v }))}
                  placeholder={t("mcp.form.urlPlaceholder")}
                  invalid={showErrors && formError === "url"}
                  editable={!isSubmitting}
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
                {showErrors && formError === "url" ? (
                  <FieldError text={t("mcp.form.urlRequired")} />
                ) : null}
              </View>

              {/* Headers */}
              <KeyValueRows
                label={t("mcp.form.headers")}
                rows={form.headers}
                keyPlaceholder={t("mcp.form.key")}
                valuePlaceholder={t("mcp.form.value")}
                addLabel={t("mcp.form.addRow")}
                removeAria={t("mcp.form.removeRow")}
                theme={theme}
                disabled={isSubmitting}
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
              />
            </>
          )}
        </>
      )}

      {showErrors && errorText ? (
        <Text className="text-xs text-destructive">{errorText}</Text>
      ) : null}

      {/* Actions */}
      <Button onPress={() => void handleSave()} disabled={!canSave}>
        <Text>
          {isSubmitting
            ? editing
              ? t("mcp.form.saving")
              : t("mcp.form.creating")
            : editing
              ? t("mcp.form.save")
              : t("mcp.form.create")}
        </Text>
      </Button>
    </View>
  );
}

function KeyValueRows({
  label,
  rows,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  removeAria,
  theme,
  disabled,
  onAdd,
  onChangeAt,
  onRemoveAt,
}: {
  label: string;
  rows: McpKeyValue[];
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  removeAria: string;
  theme: (typeof THEME)["light"];
  disabled: boolean;
  onAdd: () => void;
  onChangeAt: (index: number, patch: Partial<McpKeyValue>) => void;
  onRemoveAt: (index: number) => void;
}) {
  return (
    <View className="gap-2">
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </Text>
      {rows.map((row, index) => (
        <View key={index} className="flex-row items-center gap-2">
          <TextField
            className="flex-1"
            value={row.key}
            onChangeText={(value) => onChangeAt(index, { key: value })}
            placeholder={keyPlaceholder}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextField
            className="flex-1"
            value={row.value}
            onChangeText={(value) => onChangeAt(index, { value })}
            placeholder={valuePlaceholder}
            editable={!disabled}
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Pressable
            onPress={() => onRemoveAt(index)}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`${removeAria} ${index + 1}`}
            className="p-2"
          >
            <Ionicons name="trash-outline" size={16} color={theme.mutedForeground} />
          </Pressable>
        </View>
      ))}
      <Pressable
        onPress={onAdd}
        disabled={disabled}
        accessibilityRole="button"
        className="flex-row items-center justify-center gap-1.5 rounded-md border border-border px-3 py-2 active:bg-secondary"
        accessibilityLabel={addLabel}
      >
        <Ionicons name="add" size={15} color={theme.mutedForeground} />
        <Text className="text-sm text-muted-foreground">{addLabel}</Text>
      </Pressable>
    </View>
  );
}
