/**
 * Shared MCP server create/edit form (mobile mirror of web's
 * mcp-server-dialog.tsx guided form).
 *
 * Workspace library entries are WRITE-ONLY: the API returns name + transport
 * but never the stored config, so editing re-supplies the configuration. In
 * edit mode (`server` present) the name is kept and the form opens on the
 * summary transport; every field starts empty — the banner says so instead
 * of pretending the empty form is the saved state.
 *
 * The guided form expresses exactly two transports (stdio / http). Saving
 * from it REWRITES the entry, so a library entry whose summary transport is
 * anything else (sse/unknown) is never routed here — the list page hides the
 * edit affordance for it (mobile has no JSON editor like web).
 */
import { useCallback, useState } from "react";
import { Alert, Pressable, View } from "react-native";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import {
  emptyMcpForm,
  configFromForm,
  formFromTransport,
  type McpFormState,
  type McpKeyValue,
  type McpFormTransport,
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

const NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

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

  const [name, setName] = useState(server?.name ?? "");
  const [transport, setTransport] = useState<McpFormTransport>(
    server ? formFromTransport(server.transport).transport : "stdio",
  );
  const [command, setCommand] = useState("");
  const [argsText, setArgsText] = useState("");
  const [env, setEnv] = useState<McpKeyValue[]>([]);
  const [url, setUrl] = useState("");
  const [headers, setHeaders] = useState<McpKeyValue[]>([]);
  const [showErrors, setShowErrors] = useState(false);

  const create = useCreateWorkspaceMcpServer();
  const update = useUpdateWorkspaceMcpServer();
  const isSubmitting = create.isPending || update.isPending;

  const trimmedName = name.trim();
  const nameMissing = trimmedName === "";
  const nameFormatInvalid = !NAME_PATTERN.test(trimmedName);
  const nameDuplicate = existingNames.some(
    (existing) => existing === trimmedName && existing !== server?.name,
  );
  const commandMissing = transport === "stdio" && command.trim() === "";
  const urlMissing = transport === "http" && url.trim() === "";

  const canSave =
    !isSubmitting &&
    !nameMissing &&
    !nameFormatInvalid &&
    !nameDuplicate &&
    !commandMissing &&
    !urlMissing;

  const handleSave = useCallback(async () => {
    if (isSubmitting) return;
    if (!canSave) {
      setShowErrors(true);
      return;
    }
    const form: McpFormState = {
      ...emptyMcpForm(),
      transport,
      command,
      argsText,
      env,
      url,
      headers,
    };
    const config = configFromForm(form);
    try {
      if (editing && server) {
        await update.mutateAsync({ serverId: server.id, update: { name: trimmedName, config } });
      } else {
        await create.mutateAsync({ name: trimmedName, config });
      }
      if (onDone) onDone();
      else router.back();
    } catch (err) {
      Alert.alert(
        editing ? t("mcp.saveFailed") : t("mcp.saveFailed"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    canSave,
    transport,
    command,
    argsText,
    env,
    url,
    headers,
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
    setEnv((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  const setHeadersAt = (index: number, patch: Partial<McpKeyValue>) =>
    setHeaders((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));

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
          invalid={showErrors && (nameMissing || nameFormatInvalid || nameDuplicate)}
          editable={!isSubmitting}
          autoCapitalize="none"
          autoCorrect={false}
          autoFocus={!editing}
          maxLength={120}
        />
        {showErrors && nameMissing ? (
          <FieldError text={t("mcp.form.nameRequired")} />
        ) : null}
        {showErrors && !nameMissing && nameFormatInvalid ? (
          <FieldError text={t("mcp.form.nameInvalid")} />
        ) : null}
        {showErrors && !nameMissing && !nameFormatInvalid && nameDuplicate ? (
          <FieldError text={t("mcp.form.nameDuplicate")} />
        ) : null}
      </View>

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
              accessibilityState={{ selected: transport === option }}
              onPress={() => setTransport(option)}
              disabled={isSubmitting}
              className={cn(
                "flex-1 items-center rounded-md border px-3 py-2.5",
                transport === option
                  ? "border-brand bg-brand/10"
                  : "border-border bg-secondary/50",
              )}
            >
              <Text
                className={cn(
                  "text-sm font-medium",
                  transport === option ? "text-brand" : "text-foreground",
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

      {transport === "stdio" ? (
        <>
          {/* Command */}
          <View className="gap-1.5">
            <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("mcp.form.command")}
            </Text>
            <TextField
              value={command}
              onChangeText={setCommand}
              placeholder={t("mcp.form.commandPlaceholder")}
              invalid={showErrors && commandMissing}
              editable={!isSubmitting}
              autoCapitalize="none"
              autoCorrect={false}
            />
            {showErrors && commandMissing ? (
              <FieldError text={t("mcp.form.commandRequired")} />
            ) : null}
          </View>

          {/* Args */}
          <View className="gap-1.5">
            <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              {t("mcp.form.args")}
            </Text>
            <TextField
              value={argsText}
              onChangeText={setArgsText}
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
            rows={env}
            keyPlaceholder={t("mcp.form.key")}
            valuePlaceholder={t("mcp.form.value")}
            addLabel={t("mcp.form.addRow")}
            removeAria={t("mcp.form.removeRow")}
            theme={theme}
            disabled={isSubmitting}
            onAdd={() => setEnv((rows) => [...rows, { key: "", value: "" }])}
            onChangeAt={setEnvAt}
            onRemoveAt={(index) =>
              setEnv((rows) => rows.filter((_, i) => i !== index))
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
              value={url}
              onChangeText={setUrl}
              placeholder={t("mcp.form.urlPlaceholder")}
              invalid={showErrors && urlMissing}
              editable={!isSubmitting}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            {showErrors && urlMissing ? (
              <FieldError text={t("mcp.form.urlRequired")} />
            ) : null}
          </View>

          {/* Headers */}
          <KeyValueRows
            label={t("mcp.form.headers")}
            rows={headers}
            keyPlaceholder={t("mcp.form.key")}
            valuePlaceholder={t("mcp.form.value")}
            addLabel={t("mcp.form.addRow")}
            removeAria={t("mcp.form.removeRow")}
            theme={theme}
            disabled={isSubmitting}
            onAdd={() => setHeaders((rows) => [...rows, { key: "", value: "" }])}
            onChangeAt={setHeadersAt}
            onRemoveAt={(index) =>
              setHeaders((rows) => rows.filter((_, i) => i !== index))
            }
          />
        </>
      )}

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