/**
 * New-squad creation form (push screen). Fields follow web
 * `packages/views/modals/create-squad.tsx` + server handler/squad.go
 * semantics: name (required), optional description, and a leader agent
 * (required by the server — `leader_id is required`, and it must be an agent
 * in this workspace). Submit POSTs /api/squads and pops back to the list,
 * which refreshes on the creation invalidate.
 *
 * The leader picker (`SquadMemberPicker` in "leader" mode) lists non-archived
 * workspace agents only. The server remains the authoritative gate — a stale
 * roster that slips past filtering surfaces as a normal mutation error.
 */
import { useCallback, useState } from "react";
import { Alert, KeyboardAvoidingView, Pressable, ScrollView, View } from "react-native";
import { Stack, router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import { useQuery } from "@tanstack/react-query";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { AutosizeTextArea } from "@/components/ui/autosize-textarea";
import { TextField } from "@/components/ui/text-field";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { SquadMemberPicker } from "@/components/squad/squad-member-picker";
import { agentListOptions } from "@/data/queries/agents";
import { memberListOptions } from "@/data/queries/members";
import { useCreateSquad } from "@/data/mutations/squads";
import { useWorkspaceStore } from "@/data/workspace-store";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";
import { cn } from "@/lib/utils";

export default function NewSquadPage() {
  const { t } = useTranslation();
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [leaderId, setLeaderId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [showErrors, setShowErrors] = useState(false);

  const { data: agents = [] } = useQuery(agentListOptions(wsId));
  const { data: members = [] } = useQuery(memberListOptions(wsId));
  const createSquad = useCreateSquad();

  const nameMissing = name.trim().length === 0;
  const leaderMissing = leaderId === null;
  const isSubmitting = createSquad.isPending;

  const selectedAgent = agents.find((a) => a.id === leaderId) ?? null;

  const handleSubmit = useCallback(async () => {
    if (isSubmitting) return;
    if (nameMissing || leaderMissing) {
      setShowErrors(true);
      return;
    }
    setShowErrors(false);
    try {
      await createSquad.mutateAsync({
        name: name.trim(),
        description: description.trim() || undefined,
        leader_id: leaderId as string,
      });
      router.back();
    } catch (err) {
      Alert.alert(
        t("squads.new.failedTitle"),
        err instanceof Error ? err.message : t("common.unknownError"),
      );
    }
  }, [
    isSubmitting,
    nameMissing,
    leaderMissing,
    name,
    description,
    leaderId,
    createSquad,
    t,
  ]);

  const headerRight = useCallback(
    () => (
      <Button size="sm" disabled={isSubmitting} onPress={() => void handleSubmit()}>
        <Text>
          {isSubmitting ? t("squads.new.creating") : t("squads.new.create")}
        </Text>
      </Button>
    ),
    [isSubmitting, handleSubmit, t],
  );

  return (
    <>
      <Stack.Screen options={{ headerRight }} />
      <KeyboardAvoidingView
        className="flex-1 bg-background"
        behavior={keyboardBehavior}
      >
        <ScrollView
          className="flex-1"
          contentContainerClassName="px-4 pt-4 pb-10 gap-5"
          keyboardShouldPersistTaps="handled"
        >
          {/* Name */}
          <View className="gap-1.5">
            <FieldLabel icon="pricetag-outline" text={t("squads.new.name")} />
            <TextField
              value={name}
              onChangeText={setName}
              placeholder={t("squads.new.namePlaceholder")}
              invalid={showErrors && nameMissing}
              editable={!isSubmitting}
              autoFocus
            />
            {showErrors && nameMissing ? (
              <FieldError text={t("squads.new.nameRequired")} />
            ) : null}
          </View>

          {/* Description */}
          <View className="gap-1.5">
            <FieldLabel
              icon="document-text-outline"
              text={t("squads.new.description")}
            />
            <AutosizeTextArea
              value={description}
              onChangeText={setDescription}
              placeholder={t("squads.new.descriptionPlaceholder")}
              editable={!isSubmitting}
              className="border border-border rounded-md px-3 py-2 min-h-[72px]"
            />
          </View>

          {/* Leader */}
          <View className="gap-1.5">
            <FieldLabel icon="person-outline" text={t("squads.new.leader")} />
            {agents.length === 0 ? (
              <View className="rounded-md border border-border px-3 py-3">
                <Text className="text-sm text-muted-foreground">
                  {t("squads.new.leadersEmpty")}
                </Text>
              </View>
            ) : (
              <>
                <Pressable
                  onPress={() => setPickerOpen(true)}
                  disabled={isSubmitting}
                  accessibilityLabel={t("squads.new.selectLeader")}
                  className={cn(
                    "flex-row items-center gap-2.5 rounded-md border px-3 py-2.5",
                    showErrors && leaderMissing
                      ? "border-destructive/60 bg-destructive/10"
                      : "border-border bg-secondary/50",
                  )}
                >
                  {selectedAgent ? (
                    <>
                      <ActorAvatar type="agent" id={selectedAgent.id} size={28} />
                      <Text className="flex-1 text-sm text-foreground">
                        {selectedAgent.name}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={muted} />
                    </>
                  ) : (
                    <>
                      <Text
                        className={cn(
                          "flex-1 text-sm",
                          showErrors && leaderMissing
                            ? "text-destructive"
                            : "text-muted-foreground",
                        )}
                      >
                        {t("squads.new.selectLeader")}
                      </Text>
                      <Ionicons name="chevron-down" size={16} color={muted} />
                    </>
                  )}
                </Pressable>
                {showErrors && leaderMissing ? (
                  <FieldError text={t("squads.new.leaderRequired")} />
                ) : null}
                <SquadMemberPicker
                  visible={pickerOpen}
                  mode="leader"
                  agents={agents}
                  members={members}
                  excluded={new Set()}
                  onPick={(target) => setLeaderId(target.member_id)}
                  onClose={() => setPickerOpen(false)}
                />
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

function FieldLabel({
  icon,
  text,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  text: string;
}) {
  const { colorScheme } = useColorScheme();
  return (
    <View className="flex-row items-center gap-1.5">
      <Ionicons
        name={icon}
        size={13}
        color={THEME[colorScheme].mutedForeground}
      />
      <Text className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {text}
      </Text>
    </View>
  );
}

function FieldError({ text }: { text: string }) {
  return <Text className="text-xs text-destructive">{text}</Text>;
}