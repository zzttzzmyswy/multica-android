/**
 * Issue create settings subscreen — mirrors web
 * `packages/views/settings/components/issue-tab.tsx`. One switch list per
 * create-issue mode (agent quick create / manual create) choosing which
 * fields that mode keeps on its toolbar.
 *
 * Persisted client-side per workspace (see `issue-create-settings-store`);
 * a field toggled off stays reachable from the create form's ⋯ overflow
 * and re-surfaces automatically while it holds a value, so hiding is never
 * destructive. Same contract web encodes in its IssueTab card copy.
 *
 * Covers the full web field set: quick = project / priority / due date;
 * manual = status / priority / assignee / labels / project / due date /
 * start date.
 */
import { ScrollView, View } from "react-native";
import { Stack } from "expo-router";
import { Text } from "@/components/ui/text";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  useIssueCreateSettings,
  useIssueCreateSettingsStore,
  MANUAL_CREATE_FIELDS,
  QUICK_CREATE_FIELDS,
  type ManualCreateField,
  type QuickCreateField,
} from "@/data/issue-create-settings-store";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useTranslation } from "@/lib/i18n/react";

const QUICK_FIELD_LABEL: Record<QuickCreateField, string> = {
  project: "settings.issue.fields.project",
  priority: "settings.issue.fields.priority",
  "due-date": "settings.issue.fields.dueDate",
};

const MANUAL_FIELD_LABEL: Record<ManualCreateField, string> = {
  status: "settings.issue.fields.status",
  priority: "settings.issue.fields.priority",
  assignee: "settings.issue.fields.assignee",
  labels: "settings.issue.fields.labels",
  project: "settings.issue.fields.project",
  "due-date": "settings.issue.fields.dueDate",
  "start-date": "settings.issue.fields.startDate",
};

export default function IssueSettingsScreen() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const settings = useIssueCreateSettings(wsId);
  const setQuickVisible = useIssueCreateSettingsStore(
    (s) => s.setQuickCreateFieldVisible,
  );
  const setManualVisible = useIssueCreateSettingsStore(
    (s) => s.setManualCreateFieldVisible,
  );
  const { t } = useTranslation();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerClassName="px-4 py-4 gap-6"
    >
      <Stack.Screen options={{ title: t("settings.issueTitle") }} />

      <Text className="text-sm text-muted-foreground px-1">
        {t("settings.issue.description")}
      </Text>

      <Section
        title={t("settings.issue.quickCreateTitle")}
        description={t("settings.issue.quickCreateDescription")}
      >
        {QUICK_CREATE_FIELDS.map((field, idx) => {
          const isLast = idx === QUICK_CREATE_FIELDS.length - 1;
          return (
            <View key={field}>
              <Row
                label={t(QUICK_FIELD_LABEL[field])}
                checked={settings.quick.includes(field)}
                onToggle={(visible) =>
                  wsId && setQuickVisible(wsId, field, visible)
                }
              />
              {!isLast ? <Separator /> : null}
            </View>
          );
        })}
      </Section>

      <Section
        title={t("settings.issue.manualCreateTitle")}
        description={t("settings.issue.manualCreateDescription")}
      >
        {MANUAL_CREATE_FIELDS.map((field, idx) => {
          const isLast = idx === MANUAL_CREATE_FIELDS.length - 1;
          return (
            <View key={field}>
              <Row
                label={t(MANUAL_FIELD_LABEL[field])}
                checked={settings.manual.includes(field)}
                onToggle={(visible) =>
                  wsId && setManualVisible(wsId, field, visible)
                }
              />
              {!isLast ? <Separator /> : null}
            </View>
          );
        })}
      </Section>
    </ScrollView>
  );
}

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <View className="gap-2">
      <View className="px-1">
        <Text className="text-xs uppercase tracking-wider text-muted-foreground">
          {title}
        </Text>
        {description ? (
          <Text className="text-xs text-muted-foreground mt-1">
            {description}
          </Text>
        ) : null}
      </View>
      <View className="rounded-md border border-border bg-card overflow-hidden">
        {children}
      </View>
    </View>
  );
}

function Row({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: (visible: boolean) => void;
}) {
  return (
    <View className="flex-row items-center px-4 py-3 gap-3">
      <Text className="flex-1 text-base font-medium text-foreground">
        {label}
      </Text>
      <Switch checked={checked} onCheckedChange={onToggle} />
    </View>
  );
}
