/**
 * Pre-auth product demo page — app/(auth)/demo.tsx, reachable from the
 * login screen while signed out.
 *
 * Everything here is offline: static mock content rendered through the real
 * product primitives (StatusIcon / PriorityIcon / AttributeChip / label
 * helpers / tokens), so a demo works without an account, a workspace or a
 * network. Interaction is intentionally tiny — tap a chip to cycle a real
 * enum, tap an inbox row to mark it read — mirroring the web landing's
 * mock-visual approach
 * (apps/web/features/landing/components/features-section.tsx).
 *
 * No store, no query, no WS. Pure presentation + i18n.
 */
import { ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { MulticaLogo } from "@/components/brand/multica-logo";
import { DemoIssueCard } from "@/components/demo/demo-issue-card";
import { DemoInboxCard, type MockInboxRowData } from "@/components/demo/demo-inbox-card";
import { DemoChatCard } from "@/components/demo/demo-chat-card";
import { DemoRunCard } from "@/components/demo/demo-run-card";
import { useTranslation } from "@/lib/i18n/react";

function closeDemo() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace("/login");
  }
}

export default function Demo() {
  const { t } = useTranslation();

  const inboxRows: MockInboxRowData[] = [
    {
      id: "d1",
      title: t("demo.inbox.row1.title"),
      detail: t("demo.inbox.row1.detail"),
      time: t("demo.inbox.row1.time"),
      actorKind: "agent",
      actorInitials: "C",
      status: "in_review",
    },
    {
      id: "d2",
      title: t("demo.inbox.row2.title"),
      detail: t("demo.inbox.row2.detail"),
      time: t("demo.inbox.row2.time"),
      actorKind: "member",
      actorInitials: "AR",
      status: null,
    },
    {
      id: "d3",
      title: t("demo.inbox.row3.title"),
      detail: t("demo.inbox.row3.detail"),
      time: t("demo.inbox.row3.time"),
      actorKind: "member",
      actorInitials: "SK",
      status: null,
    },
  ];

  return (
    <SafeAreaView className="flex-1 bg-background">
      {/* Page header — self-drawn (the auth stack hides headers). */}
      <View className="h-12 flex-row items-center justify-between px-4">
        <Text className="text-base font-semibold text-foreground">{t("demo.title")}</Text>
        <IconButton
          name="close"
          iconSize={22}
          onPress={closeDemo}
          accessibilityLabel={t("demo.close")}
        />
      </View>

      <ScrollView contentContainerClassName="px-4 pb-10">
        <View className="gap-8 pt-2">
          {/* Hero */}
          <View className="items-center gap-3 px-2 pt-4">
            <MulticaLogo size={56} />
            <Text className="text-center text-2xl font-semibold leading-snug text-foreground">
              {t("demo.hero.heading")}
            </Text>
            <Text className="max-w-[300px] text-center text-sm leading-relaxed text-muted-foreground">
              {t("demo.hero.lede")}
            </Text>
          </View>

          {/* Agents */}
          <View className="gap-2">
            <View className="gap-0.5 px-1">
              <Text className="text-base font-semibold text-foreground">
                {t("demo.section.agents.title")}
              </Text>
              <Text className="text-xs leading-relaxed text-muted-foreground">
                {t("demo.section.agents.lede")}
              </Text>
            </View>
            <DemoIssueCard
              issueTitle={t("demo.issue.title")}
              issueBody={t("demo.issue.body")}
              tapHint={t("demo.issue.tapHint")}
              unassignedLabel={t("demo.unassigned")}
              activityText={t("demo.issue.activity")}
              activityActorKind="member"
              activityActorInitials="AR"
              activityTime={t("demo.issue.activityTime")}
              commentActor={t("demo.agents.claude")}
              commentText={t("demo.issue.comment")}
              commentTime={t("demo.issue.commentTime")}
            />
          </View>

          {/* Inbox */}
          <View className="gap-2">
            <View className="gap-0.5 px-1">
              <Text className="text-base font-semibold text-foreground">
                {t("demo.section.inbox.title")}
              </Text>
              <Text className="text-xs leading-relaxed text-muted-foreground">
                {t("demo.section.inbox.lede")}
              </Text>
            </View>
            <DemoInboxCard rows={inboxRows} />
          </View>

          {/* Chat */}
          <View className="gap-2">
            <View className="gap-0.5 px-1">
              <Text className="text-base font-semibold text-foreground">
                {t("demo.section.chat.title")}
              </Text>
              <Text className="text-xs leading-relaxed text-muted-foreground">
                {t("demo.section.chat.lede")}
              </Text>
            </View>
            <DemoChatCard
              askText={t("demo.chat.ask")}
              askTime={t("demo.chat.time.ask")}
              agentName={t("demo.agents.claude")}
              replyText={t("demo.chat.reply")}
              replyTime={t("demo.chat.time.reply")}
              workingText={t("demo.chat.working")}
            />
          </View>

          {/* Runs */}
          <View className="gap-2">
            <View className="gap-0.5 px-1">
              <Text className="text-base font-semibold text-foreground">
                {t("demo.section.run.title")}
              </Text>
              <Text className="text-xs leading-relaxed text-muted-foreground">
                {t("demo.section.run.lede")}
              </Text>
            </View>
            <DemoRunCard
              headerLabel={t("demo.run.header")}
              toolCallsLabel={t("demo.run.toolCalls")}
              toolRows={[
                { tool: "Read", summary: "server/internal/handler/issue.go" },
                {
                  tool: "Edit",
                  summary: "server/internal/handler/issue.go — replace writeJSON error calls",
                },
                {
                  tool: "Bash",
                  summary: "go test ./internal/handler/ -run TestErrorResponses",
                },
              ]}
              taskHeader={t("demo.run.taskHeader")}
              tasks={[
                {
                  id: "t1",
                  title: t("demo.run.tasks.one.title"),
                  duration: t("demo.run.tasks.one.duration"),
                },
                {
                  id: "t2",
                  title: t("demo.run.tasks.two.title"),
                  duration: t("demo.run.tasks.two.duration"),
                },
                {
                  id: "t3",
                  title: t("demo.run.tasks.three.title"),
                  duration: t("demo.run.tasks.three.duration"),
                  running: true,
                },
              ]}
            />
          </View>

          {/* Footer CTA */}
          <View className="gap-2.5 border-t border-border pt-5">
            <Text className="px-1 text-center text-base font-semibold text-foreground">
              {t("demo.footer.title")}
            </Text>
            <Button size="lg" onPress={closeDemo}>
              <Text>{t("demo.footer.cta")}</Text>
            </Button>
            <Text className="px-4 text-center text-xs leading-relaxed text-muted-foreground">
              {t("demo.footer.hint")}
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}