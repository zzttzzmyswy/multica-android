import { useEffect } from "react";
import type { ComponentProps } from "react";
import { Redirect, Stack, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { workspaceListOptions } from "@/data/queries/workspaces";
import { useWorkspaceStore } from "@/data/workspace-store";
import { RealtimeProvider } from "@/data/realtime/realtime-provider";
import { UpdateProvider } from "@/components/update/update-provider";
import { useInboxRealtime } from "@/data/realtime/use-inbox-realtime";
import { useIssuesRealtime } from "@/data/realtime/use-issues-realtime";
import { useMyIssuesRealtime } from "@/data/realtime/use-my-issues-realtime";
import { useChatSessionsRealtime } from "@/data/realtime/use-chat-sessions-realtime";
import { useProjectsRealtime } from "@/data/realtime/use-projects-realtime";
import { usePinsRealtime } from "@/data/realtime/use-pins-realtime";
import { usePresenceRealtime } from "@/data/realtime/use-presence-realtime";
import { useWorkspacePresencePrefetch } from "@/lib/use-workspace-presence-prefetch";
import { ModalCloseButton } from "@/components/ui/modal-close-button";
import { useNewIssueDraftResetOnWorkspaceChange } from "@/data/stores/new-issue-draft-store";
import { useNewProjectDraftResetOnWorkspaceChange } from "@/data/stores/new-project-draft-store";
import { useChatSessionPickerResetOnWorkspaceChange } from "@/data/stores/chat-session-picker-store";
import { useTranslation } from "@/lib/i18n/react";

/**
 * Shared Stack.Screen options for every iOS formSheet-presented sheet route.
 *
 * Why these specific values:
 *   - `presentation: "formSheet"` instantiates iOS
 *     UISheetPresentationController — native grabber, stacked-card backdrop,
 *     drag-to-dismiss spring physics, detents.
 *   - `sheetAllowedDetents: [0.6, 0.95]` — explicit numeric detents. The
 *     ergonomic `"fitToContents"` is broken on iOS 26 + Expo 55
 *     (expo/expo#42904 padding inconsistency, expo/expo#42965 zero-size).
 *     Predictable two-snap presentation across every picker-row sheet >
 *     shrink-wrap; this is the right default for sheets that sit next to
 *     other sheets in the same chip row (issue / project AttributeRow) so
 *     the user gets the same gesture regardless of which chip they tap.
 *     Isolated sheets that have no neighbour to be consistent with (e.g.
 *     the workspace `menu` sheet) override this with `"fitToContents"`
 *     to avoid the large blank area below their content.
 *   - `sheetGrabberVisible: true` — surfaces the iOS native drag handle
 *     so users discover the gesture.
 *   - `contentStyle.height: "100%"` — safety net against the same
 *     zero-size class of bugs above; ensures the sheet body fills the
 *     allotted detent.
 *   - `headerShown: false` — every sheet body draws its own header (title
 *     + optional right action). The native Stack header would double up.
 */
const SHEET_OPTIONS: ComponentProps<typeof Stack.Screen>["options"] = {
  presentation: "formSheet",
  sheetGrabberVisible: true,
  sheetAllowedDetents: [0.6, 0.95],
  sheetCornerRadius: 20,
  contentStyle: { flex: 1 },
  headerShown: false,
};

/**
 * Cold-start deep-link anchor. Expo Router otherwise treats whatever
 * route resolves the URL as the root of the stack — if the user opens a
 * notification that targets `issue/[id]/picker/status` directly, they
 * land on the formSheet with NO parent under it, no way to go back to
 * the tabs. `anchor: "(tabs)"` tells the router to mount the tab UI as
 * the implicit underlying screen so back/swipe-dismiss returns the user
 * to a sensible base state.
 */
export const unstable_settings = { anchor: "(tabs)" } as const;

/**
 * Mounts every per-feature realtime subscription. Lives inside
 * RealtimeProvider so the WSClient context is available, and stays alive
 * for the whole workspace session — the inbox unread count must keep
 * refreshing even while the user is on an issue page or settings, not
 * just when the inbox tab is foregrounded.
 *
 * Add new realtime feature hooks here as they land (issue, chat, etc).
 */
function RealtimeSubscriptions() {
  useInboxRealtime();
  useIssuesRealtime();
  useMyIssuesRealtime();
  useChatSessionsRealtime();
  useProjectsRealtime();
  usePinsRealtime();
  // Presence: warm the three queries up front so avatars don't flash a
  // dotless first render, and listen for daemon/agent/task events to keep
  // the runtime + snapshot caches fresh. See use-presence-realtime.ts for
  // the deliberately-skipped high-frequency events.
  useWorkspacePresencePrefetch();
  usePresenceRealtime();
  return null;
}

/**
 * Workspace context layout. Reads the slug from the URL (the route is the
 * source of truth — see apps/mobile/CLAUDE.md "Behavioral parity"), validates
 * membership against the workspaces list, then syncs id+slug into the
 * Zustand store so ApiClient.fetch can read the slug synchronously when
 * injecting the X-Workspace-Slug header.
 *
 * If the slug doesn't match any workspace the user belongs to, redirect to
 * /select-workspace (covers stale persisted slugs after the user lost
 * membership, deep links to wrong slugs, etc.).
 */
export default function WorkspaceLayout() {
  const { workspace: slug } = useLocalSearchParams<{ workspace: string }>();
  const { data: workspaces, isLoading } = useQuery(workspaceListOptions());
  const setCurrentWorkspace = useWorkspaceStore((s) => s.setCurrentWorkspace);
  const { t } = useTranslation();

  const matched = workspaces?.find((w) => w.slug === slug);

  useEffect(() => {
    if (matched) {
      setCurrentWorkspace(matched.id, matched.slug);
    }
  }, [matched, setCurrentWorkspace]);

  // Wipe cross-route Zustand draft stores whenever the active workspace
  // changes — a draft picked under workspace A (assignee id, draft
  // session id, etc.) is invalid in workspace B and must not leak.
  useNewIssueDraftResetOnWorkspaceChange(matched?.id ?? null);
  useNewProjectDraftResetOnWorkspaceChange(matched?.id ?? null);
  useChatSessionPickerResetOnWorkspaceChange(matched?.id ?? null);

  // Wait for the workspaces list before deciding membership — otherwise a
  // valid deep link would briefly redirect away on cold start.
  if (isLoading) return null;

  if (!matched) return <Redirect href="/select-workspace" />;

  // Tabs hide their own header; pushed screens (issue/[id]) get a native
  // iOS Stack header with the standard back button + swipe-to-dismiss.
  return (
    <UpdateProvider>
      <RealtimeProvider>
        <RealtimeSubscriptions />
        <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen
          name="issue/[id]"
          options={{
            title: t("screen.issue"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="project/[id]"
          options={{
            title: t("screen.project"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="project/[id]/edit"
          options={{
            title: t("screen.editProject"),
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="issue/[id]/edit"
          options={{
            title: t("screen.editIssue"),
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="project/new"
          options={{
            title: t("screen.newProject"),
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        {/* Issue-detail formSheet pickers. All share the same sheet config:
            explicit numeric detents to dodge expo/expo#42904+#42965 (the
            `fitToContents` zero-size / padding bugs on iOS 26 + Expo 55),
            iOS native grabber, and contentStyle.height=100% as a safety
            net against the same zero-size class of bugs. */}
        <Stack.Screen
          name="issue/[id]/picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/priority"
          options={SHEET_OPTIONS}
        />
        {/* Experiment: assignee uses iOS-native nav header + UISearchController
            instead of the body-rendered header pattern in SHEET_OPTIONS.
            Eliminates the #3634 overlap class of bugs and the focus-loss
            footgun of a custom TextInput inside ListHeaderComponent. The
            route file wires `headerSearchBarOptions` via setOptions. If this
            proves out, propagate to label / project / other search pickers
            and update CLAUDE.md Lesson 6 with a carve-out. */}
        <Stack.Screen
          name="issue/[id]/picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("screen.assignee"),
          }}
        />
        <Stack.Screen
          name="issue/[id]/picker/label"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="mention-picker"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("screen.mention"),
          }}
        />
        <Stack.Screen
          name="issue/[id]/picker/project"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/due-date"
          options={SHEET_OPTIONS}
        />
        {/* Workspace custom-property pickers (MYS-334): single-property value
            editor + add-property list. Both share the standard sheet config. */}
        <Stack.Screen
          name="issue/[id]/picker/property"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="issue/[id]/picker/properties"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen name="issue/[id]/runs" options={SHEET_OPTIONS} />
        {/* Full emoji picker for a comment reaction. Pushed from the "+"
            button inside the comment long-press tapback row — see
            components/issue/comment-context-menu.tsx. */}
        <Stack.Screen
          name="issue/[id]/comment/[commentId]/emoji-picker"
          options={SHEET_OPTIONS}
        />
        {/* Project-detail formSheet pickers. */}
        <Stack.Screen
          name="project/[id]/picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/picker/priority"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/picker/lead"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="project/[id]/add-resource"
          options={SHEET_OPTIONS}
        />
        {/* New-issue draft formSheet pickers — stacked on top of the
            new-issue.tsx Stack.Screen (which is itself a `modal`).
            Expo Router 55 / RN Screens 4 support a formSheet pushed on top
            of a modal in the same Stack. */}
        <Stack.Screen
          name="new-issue-picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/priority"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/assignee"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("screen.assignee"),
          }}
        />
        <Stack.Screen
          name="new-issue-picker/labels"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("attr.labels"),
          }}
        />
        <Stack.Screen
          name="new-issue-picker/agent"
          options={{
            ...SHEET_OPTIONS,
            headerShown: true,
            title: t("newIssue.agentSelectAgent"),
          }}
        />
        <Stack.Screen
          name="new-issue-picker/project"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/due-date"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-issue-picker/start-date"
          options={SHEET_OPTIONS}
        />
        {/* New-project draft formSheet pickers — same pattern as
            new-issue-picker/*. Stacked on top of `project/new` (a modal). */}
        <Stack.Screen
          name="new-project-picker/status"
          options={SHEET_OPTIONS}
        />
        <Stack.Screen
          name="new-project-picker/priority"
          options={SHEET_OPTIONS}
        />
        {/* Shared filter sheet for My Issues and the workspace Issues page —
            chooses the right view-store via `?scope=my|all` URL param. */}
        <Stack.Screen name="issues-filter" options={SHEET_OPTIONS} />
        {/* Multi-select dimension picker pushed from the filter panel
            (`?dim=assignee|creator|project|label` + `?scope=`). Registered
            with the stock SHEET_OPTIONS; the body draws its own title+Done
            header like the parent panel. */}
        <Stack.Screen name="issues-filter-picker" options={SHEET_OPTIONS} />
        {/* Chat session-switch sheet. */}
        <Stack.Screen name="chat-sessions" options={SHEET_OPTIONS} />
        {/* Workspace switcher — reached from the More popover's collapsed
            WorkspaceCard. Two-step (pick → iOS Alert confirm → switch). */}
        <Stack.Screen name="switch-workspace" options={SHEET_OPTIONS} />
        <Stack.Screen
          name="more/issues"
          options={{ title: t("screen.issues"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/autopilots"
          options={{ title: t("screen.autopilots"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/autopilots/[id]"
          options={{
            title: t("screen.autopilots"),
            headerBackTitle: t("screen.autopilots"),
          }}
        />
        <Stack.Screen
          name="more/autopilots/new"
          options={{
            title: t("autopilots.new.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/autopilots/[id]/trigger"
          options={{
            title: t("autopilots.trigger.adding"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/projects"
          options={{ title: t("screen.projects"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/agents"
          options={{ title: t("screen.agents"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/agents/[id]"
          options={{ title: t("screen.agents"), headerBackTitle: t("screen.agents") }}
        />
        <Stack.Screen
          name="more/agents/[id]/edit"
          options={{
            title: t("agents.edit.title"),
            headerBackTitle: t("agents.edit.title"),
          }}
        />
        <Stack.Screen
          name="more/agents/[id]/env"
          options={{
            title: t("agents.env.title"),
            headerBackTitle: t("agents.env.title"),
          }}
        />
        <Stack.Screen
          name="more/agents/new"
          options={{ title: t("screen.agents"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/agents/new/manual"
          options={{
            title: t("agents.new.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/agents/new/ai"
          options={{
            title: t("agents.new.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/agents/builder/[sessionId]"
          options={{
            title: t("agents.new.ai.sessionTitle"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/members"
          options={{ title: t("screen.members"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/members/[id]"
          options={{ title: t("screen.members"), headerBackTitle: t("screen.members") }}
        />
        <Stack.Screen
          name="more/squads"
          options={{ title: t("screen.squads"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/squads/[id]"
          options={{ title: t("screen.squads"), headerBackTitle: t("screen.squads") }}
        />
        <Stack.Screen
          name="more/squads/new"
          options={{
            title: t("squads.new.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/labels"
          options={{ title: t("screen.labels"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/labels/new"
          options={{
            title: t("labels.new.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/labels/[id]"
          options={{
            title: t("labels.edit.title"),
            headerBackTitle: t("screen.labels"),
          }}
        />
        <Stack.Screen
          name="more/skills"
          options={{ title: t("screen.skills"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/skills/new"
          options={{
            title: t("skills.new.title"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/skills/[id]"
          options={{
            title: t("screen.skills"),
            headerBackTitle: t("screen.skills"),
          }}
        />
        <Stack.Screen
          name="more/mcp-servers"
          options={{ title: t("screen.mcpServers"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/mcp-servers/new"
          options={{
            title: t("mcp.form.createTitle"),
            headerBackTitle: t("screen.mcpServers"),
          }}
        />
        <Stack.Screen
          name="more/mcp-servers/[id]"
          options={{
            title: t("mcp.form.editTitle"),
            headerBackTitle: t("screen.mcpServers"),
          }}
        />
        <Stack.Screen
          name="more/runtimes"
          options={{
            title: t("screen.runtimes"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/usage"
          options={{
            title: t("screen.usage"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/downloads"
          options={{
            title: t("screen.downloads"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/runtimes/[id]"
          options={{
            title: t("screen.runtimes"),
            headerBackTitle: t("screen.runtimes"),
          }}
        />
        <Stack.Screen
          name="more/about"
          options={{
            title: t("screen.about"),
            headerBackTitle: t("common.back"),
          }}
        />
        <Stack.Screen
          name="more/pins"
          options={{ title: t("screen.pinned"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/settings"
          options={{ title: t("screen.settings"), headerBackTitle: t("common.back") }}
        />
        <Stack.Screen
          name="more/settings/profile"
          options={{ title: t("screen.profile"), headerBackTitle: t("screen.settings") }}
        />
        <Stack.Screen
          name="more/settings/workspace"
          options={{ title: t("screen.workspaceSettings"), headerBackTitle: t("screen.settings") }}
        />
        <Stack.Screen
          name="more/settings/notifications"
          options={{ title: t("screen.notifications"), headerBackTitle: t("screen.settings") }}
        />
        <Stack.Screen
          name="more/settings/tokens"
          options={{ title: t("screen.tokens"), headerBackTitle: t("screen.settings") }}
        />
        <Stack.Screen
          name="new-issue"
          options={{
            title: t("screen.newIssue"),
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
        <Stack.Screen
          name="search"
          options={{
            title: t("screen.search"),
            presentation: "modal",
            headerLeft: () => <ModalCloseButton />,
          }}
        />
      </Stack>
      </RealtimeProvider>
    </UpdateProvider>
  );
}
