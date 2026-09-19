/**
 * URL skill import (mobile mirror of web create-skill-dialog.tsx's `UrlForm`,
 * :280-415).
 *
 * The client gate is deliberately thin: a non-empty trimmed URL is the only
 * precondition, because the server owns source detection and validation. What
 * the client adds is the source hint — three cards showing the hosts the
 * importer understands, with the detected one highlighted, so a user who
 * pastes something else can see it will not be recognised.
 */
import { useCallback, useState } from "react";
import { Linking, Pressable, View } from "react-native";import Ionicons from "@expo/vector-icons/Ionicons";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { TextField } from "@/components/ui/text-field";
import { useImportSkill } from "@/data/mutations/skills";
import {
  SKILL_IMPORT_SOURCES,
  SKILL_SOURCE_BROWSE_URL,
  SKILL_SOURCE_EXAMPLE_HOST,
  SKILL_SOURCE_LABEL_KEY,
  detectSkillImportSource,
  isNameConflictError,
  skillImportUrlReady,
} from "@/lib/skill-import";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export function SkillUrlImportForm({ onImported }: { onImported: () => void }) {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const theme = THEME[colorScheme];

  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  const importSkill = useImportSkill();

  const source = detectSkillImportSource(url);
  const ready = skillImportUrlReady(url) && !importSkill.isPending;

  // Web swaps the button label per detected source while the request is in
  // flight — the wait is dominated by the server fetching the source, so the
  // label tells the user which host is being contacted.
  const buttonLabel = !importSkill.isPending
    ? t("skills.import.import")
    : source === "clawhub"
      ? t("skills.import.importingClawhub")
      : source === "skills_sh"
        ? t("skills.import.importingSkillsSh")
        : source === "github"
          ? t("skills.import.importingGithub")
          : t("skills.import.importing");

  const handleImport = useCallback(async () => {
    if (!ready) return;
    setError("");
    try {
      await importSkill.mutateAsync(url.trim());
      onImported();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : t("common.unknownError");
      setError(
        isNameConflictError(message)
          ? `${message}${t("skills.import.nameConflictHint")}`
          : message,
      );
    }
  }, [ready, importSkill, url, onImported, t]);

  return (
    <View className="px-4 pt-4 gap-5">
      <View className="gap-1.5">
        <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          {t("skills.import.urlLabel")}
        </Text>
        <TextField
          value={url}
          onChangeText={(v) => {
            setUrl(v);
            setError("");
          }}
          placeholder="https://clawhub.ai/owner/skill"
          autoFocus
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          returnKeyType="go"
          editable={!importSkill.isPending}
          onSubmitEditing={() => void handleImport()}
          className="font-mono"
        />
      </View>

      <View className="gap-2">
        <Text className="text-xs text-muted-foreground">
          {t("skills.import.supportedSources")}
        </Text>
        <View className="flex-row gap-2">
          {SKILL_IMPORT_SOURCES.map((option) => {
            const active = source === option;
            return (
              <Pressable
                key={option}
                accessibilityRole="link"
                accessibilityLabel={t(SKILL_SOURCE_LABEL_KEY[option])}
                onPress={() =>
                  void Linking.openURL(SKILL_SOURCE_BROWSE_URL[option])
                }
                className={cn(
                  "flex-1 min-w-0 rounded-md border px-2.5 py-2 gap-0.5",
                  active ? "border-brand bg-brand/5" : "border-border",
                )}
              >
                <Text className="text-xs font-medium text-foreground">
                  {t(SKILL_SOURCE_LABEL_KEY[option])}
                </Text>
                <Text
                  numberOfLines={1}
                  className={cn(
                    "text-[11px] font-mono",
                    active ? "text-brand" : "text-muted-foreground",
                  )}
                >
                  {SKILL_SOURCE_EXAMPLE_HOST[option]}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      {error ? (
        <View className="flex-row items-start gap-2 rounded-md bg-destructive/10 px-3 py-2">
          <Ionicons
            name="alert-circle-outline"
            size={14}
            color={theme.destructive}
          />
          <Text className="flex-1 text-xs text-destructive leading-4">
            {error}
          </Text>
        </View>
      ) : null}

      <Button
        onPress={() => void handleImport()}
        disabled={!ready}
        accessibilityState={{ disabled: !ready }}
      >
        <Text>{buttonLabel}</Text>
      </Button>
    </View>
  );
}
