/**
 * Workspace global search modal.
 *
 * Mirrors packages/views/search/search-command.tsx but is scoped to
 * search-only — mobile IA puts page nav in the More popover and
 * workspace switching in Settings, so a command-palette here would
 * duplicate them (see feedback_mobile_ia_main_vs_more).
 *
 * Iteration 205 narrows that boundary rather than moving it: the header stays
 * the only entry point, and the field gains an answer for queries it used to
 * reject outright. Before this, typing `settings` matched nothing (the server
 * searches issues and projects) and the screen said "No results" — a dead end
 * for anyone who reasonably typed a destination. It now also answers with
 * web's Pages and Commands groups (`lib/search-commands.ts`): 8 destinations
 * and the 3 theme switches. Nav is still reachable from the More popover; this
 * is a second route to it, not a replacement.
 *
 * Result categories, ordering (pages → commands → live projects → live issues
 * → a trailing Cancelled section — see lib/search-rows.ts), debounce (300ms),
 * abort policy, and Recent rendering mirror the web source.
 * Highlight + snippet lines preserve the "why did this match" signal users
 * rely on when scanning results, and the row's trailing slot carries the
 * assignee so "who owns this" survives the scan too.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Pressable,
  TextInput,
  View,
  type ListRenderItem,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useQueries, useQuery } from "@tanstack/react-query";
import { router } from "expo-router";
import Ionicons from "@expo/vector-icons/Ionicons";
import type {
  Issue,
  MemberWithUser,
  SearchIssueResult,
  SearchProjectResult,
} from "@multica/core/types";
import { Text } from "@/components/ui/text";
import { StatusIcon } from "@/components/ui/status-icon";
import { PriorityIcon } from "@/components/ui/priority-icon";
import { ProjectIcon } from "@/components/ui/project-icon";
import { ProjectStatusIcon } from "@/components/ui/project-status-icon";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { api } from "@/data/api";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  selectViewedIssueIds,
  useViewedIssuesStore,
} from "@/data/viewed-issues-store";
import { issueDetailOptions } from "@/data/queries/issues";
import { memberListOptions } from "@/data/queries/members";
import { useIssueStatuses } from "@/data/queries/issue-statuses";
import { projectStatusLabel } from "@/lib/project-status";
import { buildSearchRows, type RowItem } from "@/lib/search-rows";
import {
  buildSearchCommands,
  buildSearchPages,
  filterSearchCommands,
  filterSearchPages,
  type SearchCommand,
  type SearchCommandKey,
  type SearchPage,
  type SearchPageKey,
} from "@/lib/search-commands";
import { searchIssueSnippets } from "@/lib/search-snippets";
import { filterMemberMatches } from "@/lib/member-search";
import { keyboardBehavior } from "@/lib/keyboard";
import { useTranslation } from "@/lib/i18n/react";
import { useColorScheme } from "@/lib/use-color-scheme";
import { THEME } from "@/lib/theme";

const DEBOUNCE_MS = 300;
const ISSUE_LIMIT = 20;
const PROJECT_LIMIT = 10;
const RECENT_LIMIT = 5;

// =====================================================
// HighlightText — mobile port of web's HighlightText
// =====================================================
// Web uses an HTML <mark> which doesn't exist in RN, so we segment the
// string ourselves and wrap matched parts in a styled <Text>. Same regex
// escape + case-insensitive substring match as
// packages/views/search/search-command.tsx:55-89.

interface HighlightTextProps {
  text: string;
  query: string;
  className?: string;
  numberOfLines?: number;
}

function HighlightText({
  text,
  query,
  className,
  numberOfLines,
}: HighlightTextProps) {
  const parts = useMemo(() => {
    const q = query.trim();
    if (!q) return [{ text, hit: false }];
    const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`(${escaped})`, "gi");
    const out: { text: string; hit: boolean }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(text)) !== null) {
      if (m.index > last) out.push({ text: text.slice(last, m.index), hit: false });
      out.push({ text: m[0], hit: true });
      last = regex.lastIndex;
    }
    if (last < text.length) out.push({ text: text.slice(last), hit: false });
    return out.length > 0 ? out : [{ text, hit: false }];
  }, [text, query]);

  return (
    <Text className={className} numberOfLines={numberOfLines}>
      {parts.map((p, i) =>
        p.hit ? (
          // Inline hex (yellow-200) instead of a Tailwind class because the
          // mobile tailwind.config.js intentionally curates its own palette
          // (no `yellow-*`) — see apps/mobile/CLAUDE.md "Visual tokens".
          <Text
            key={i}
            className="text-foreground"
            style={{ backgroundColor: "#fef08a" }}
          >
            {p.text}
          </Text>
        ) : (
          <Text key={i}>{p.text}</Text>
        ),
      )}
    </Text>
  );
}

// =====================================================
// Row item types — drives the single FlatList render
// =====================================================
// RowItem + buildSearchRows live in lib/search-rows.ts so the ordering rules
// (including the cancelled partition) are testable without mounting the screen.

function navigateOnTap(slug: string | null, path: string) {
  // Search is `presentation: "modal"` (see (app)/[workspace]/_layout.tsx).
  // `router.replace` swaps the modal out for the destination in a single
  // atomic transition — the new screen renders with its own presentation
  // (default `card`), and the resulting history is `[..., inbox, detail]`,
  // so the user's back gesture lands on the screen that was under search.
  if (!slug) return;
  router.replace(path);
}

/**
 * Trailing assignee avatar, mirroring web's `IssueAssigneeAvatar`
 * (search-command.tsx:111-127). Renders nothing when the issue is unassigned —
 * an empty actor chip would read as "assigned to nobody in particular" rather
 * than "unassigned".
 */
function IssueAssigneeAvatar({
  assigneeType,
  assigneeId,
}: {
  assigneeType?: string | null;
  assigneeId?: string | null;
}) {
  if (!assigneeType || !assigneeId) return null;
  return (
    <ActorAvatar
      type={assigneeType as React.ComponentProps<typeof ActorAvatar>["type"]}
      id={assigneeId}
      size={20}
    />
  );
}

interface SearchIssueRowProps {
  item: SearchIssueResult;
  query: string;
  slug: string | null;
}

function SearchIssueRow({ item, query, slug }: SearchIssueRowProps) {
  // One line per snippet kind, in web's order (description then comment);
  // a result can carry both. Reading the canonical fields rather than
  // `match_source` + `matched_snippet` is what makes a description-only hit
  // visible at all — see lib/search-snippets.ts for the server field semantics.
  const snippets = searchIssueSnippets(item);
  const { colorScheme } = useColorScheme();
  const muted = THEME[colorScheme].mutedForeground;
  const statusEntry = useIssueStatuses().entryOf(item.status);
  return (
    <Pressable
      onPress={() => navigateOnTap(slug, `/${slug}/issue/${item.id}`)}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="flex-row items-center gap-3">
        <StatusIcon
          status={item.status}
          category={statusEntry?.category}
          color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
          size={14}
        />
        <PriorityIcon priority={item.priority} size={14} />
        <Text className="text-caption text-muted-foreground shrink-0 w-16">
          {item.identifier}
        </Text>
        <View className="flex-1">
          <HighlightText
            text={item.title}
            query={query}
            className="text-body text-foreground"
            numberOfLines={1}
          />
        </View>
        <IssueAssigneeAvatar
          assigneeType={item.assignee_type}
          assigneeId={item.assignee_id}
        />
      </View>
      {snippets.map((snippet) => (
        <View
          key={snippet.kind}
          className="flex-row items-start gap-2 mt-1 pl-[68px]"
        >
          <Ionicons
            name={
              snippet.kind === "description"
                ? "document-text-outline"
                : "chatbubble-outline"
            }
            size={12}
            color={muted}
            style={{ marginTop: 2 }}
          />
          <View className="flex-1">
            <HighlightText
              text={snippet.text}
              query={query}
              className="text-caption text-muted-foreground"
              numberOfLines={1}
            />
          </View>
        </View>
      ))}
    </Pressable>
  );
}

interface SearchProjectRowProps {
  item: SearchProjectResult;
  query: string;
  slug: string | null;
}

function SearchProjectRow({ item, query, slug }: SearchProjectRowProps) {
  const showSnippet =
    item.match_source === "description" && !!item.matched_snippet;
  return (
    <Pressable
      onPress={() => navigateOnTap(slug, `/${slug}/project/${item.id}`)}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="flex-row items-center gap-3">
        <ProjectIcon icon={item.icon} size="md" />
        <View className="flex-1">
          <HighlightText
            text={item.title}
            query={query}
            className="text-body text-foreground"
            numberOfLines={1}
          />
        </View>
        <View className="flex-row items-center gap-1.5 shrink-0">
          <ProjectStatusIcon status={item.status} size={12} />
          <Text className="text-caption text-muted-foreground">
            {projectStatusLabel(item.status)}
          </Text>
        </View>
      </View>
      {showSnippet ? (
        <View className="flex-row items-start mt-1 pl-[36px]">
          <View className="flex-1">
            <HighlightText
              text={item.matched_snippet ?? ""}
              query={query}
              className="text-caption text-muted-foreground"
              numberOfLines={1}
            />
          </View>
        </View>
      ) : null}
    </Pressable>
  );
}

interface SearchMemberRowProps {
  member: MemberWithUser;
  query: string;
  slug: string | null;
}

function SearchMemberRow({ member, query, slug }: SearchMemberRowProps) {
  return (
    <Pressable
      onPress={() => navigateOnTap(slug, `/${slug}/more/members/${member.id}`)}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="flex-row items-center gap-3">
        <ActorAvatar type="member" id={member.user_id} size={28} />
        <View className="flex-1 min-w-0 gap-0.5">
          <HighlightText
            text={member.name}
            query={query}
            className="text-body text-foreground"
            numberOfLines={1}
          />
          <HighlightText
            text={member.email}
            query={query}
            className="text-caption text-muted-foreground"
            numberOfLines={1}
          />
        </View>
        <Text className="text-caption text-muted-foreground shrink-0">
          {member.role}
        </Text>
      </View>
    </Pressable>
  );
}

interface RecentRowProps {
  item: Issue;
  slug: string | null;
}

function RecentRow({ item, slug }: RecentRowProps) {
  const statusEntry = useIssueStatuses().entryOf(item.status);
  return (
    <Pressable
      onPress={() => navigateOnTap(slug, `/${slug}/issue/${item.id}`)}
      className="active:bg-secondary px-4 py-3"
    >
      <View className="flex-row items-center gap-3">
        <StatusIcon
          status={item.status}
          category={statusEntry?.category}
          color={statusEntry?.is_system ? undefined : (statusEntry?.color ?? undefined)}
          size={14}
        />
        <Text className="text-caption text-muted-foreground shrink-0 w-16">
          {item.identifier}
        </Text>
        <Text className="flex-1 text-body text-foreground" numberOfLines={1}>
          {item.title}
        </Text>
        <IssueAssigneeAvatar
          assigneeType={item.assignee_type}
          assigneeId={item.assignee_id}
        />
      </View>
    </Pressable>
  );
}

// =====================================================
// Action rows — Pages + Commands
// =====================================================
// One component for both groups: web renders them from the same item markup
// (`search-command.tsx:686-720`), and neither carries a subtitle or trailing
// record — just icon + label + optional checkmark.
//
// Icons are chosen per key rather than derived from the route (web uses
// `routeIconForPath`). Mobile has no route→icon table, and the More popover
// already names an icon for every one of these destinations; these match
// those so a destination looks the same wherever it is listed.

const PAGE_ICONS: Record<SearchPageKey, keyof typeof Ionicons.glyphMap> = {
  // Same glyphs the destination already carries elsewhere: the tab bar for
  // Inbox / My Issues / Projects, the More popover for the rest. A page that
  // looked different here than in the nav it mirrors would be harder to
  // recognise, not easier.
  inbox: "file-tray-outline",
  myIssues: "checkbox-outline",
  issues: "list",
  projects: "layers-outline",
  agents: "hardware-chip",
  runtimes: "server",
  skills: "extension-puzzle",
  settings: "settings-outline",
};

const COMMAND_ICONS: Record<SearchCommandKey, keyof typeof Ionicons.glyphMap> = {
  "new-issue": "add-circle-outline",
  "new-project": "add-circle-outline",
  "theme-light": "sunny-outline",
  "theme-dark": "moon-outline",
  "theme-system": "phone-portrait-outline",
};

function ActionRow({
  icon,
  label,
  query,
  trailing,
  onPress,
}: {
  icon: React.ReactNode;
  label: string;
  query: string;
  trailing?: React.ReactNode;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="active:bg-secondary px-4 py-3">
      <View className="flex-row items-center gap-3">
        {icon}
        <HighlightText
          text={label}
          query={query}
          className="flex-1 text-body text-foreground"
          numberOfLines={1}
        />
        {trailing}
      </View>
    </Pressable>
  );
}

// =====================================================
// Screen
// =====================================================

interface SearchResultsState {
  issues: SearchIssueResult[];
  projects: SearchProjectResult[];
}

const EMPTY_RESULTS: SearchResultsState = { issues: [], projects: [] };

export default function SearchModal() {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const slug = useWorkspaceStore((s) => s.currentWorkspaceSlug);
  const {
    colorScheme,
    preference: themePreference,
    setPreference,
  } = useColorScheme();
  const theme = THEME[colorScheme];
  const { t } = useTranslation();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResultsState>(EMPTY_RESULTS);
  const [isLoading, setIsLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Recent — mirrors mention-suggestion-bar.tsx:85-95.
  const viewedIds = useViewedIssuesStore(selectViewedIssueIds(wsId));
  const recentIds = useMemo(
    () => viewedIds.slice(0, RECENT_LIMIT),
    [viewedIds],
  );
  const recentQueries = useQueries({
    queries: recentIds.map((id) => issueDetailOptions(wsId, id)),
  });
  const recentIssues = useMemo<Issue[]>(
    () =>
      recentQueries
        .map((q) => q.data)
        .filter((i): i is Issue => !!i),
    [recentQueries],
  );

  // Members for the member search section (iteration 89). Loaded once per
  // workspace; filtering happens client-side in filterMemberMatches
  // (port of web search-command.tsx).
  const { data: memberRows = [] } = useQuery(memberListOptions(wsId));

  // Cleanup pending debounce + abort on unmount. Without this, navigating
  // away mid-request leaves a dangling timeout + an in-flight fetch whose
  // setState would warn against an unmounted component.
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      if (abortRef.current) abortRef.current.abort();
    };
  }, []);

  const runSearch = useCallback((q: string) => {
    // Race-correctness: clear the pending debounce AND abort any in-flight
    // controller BEFORE the early-return / state writes below. The abort
    // is synchronous (signal.aborted flips immediately), so the post-await
    // guard in the timeout body will skip stale `setResults` / `setIsLoading`
    // even if the network response arrives later.
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();

    if (!q.trim()) {
      setResults(EMPTY_RESULTS);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    debounceRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const [issueRes, projectRes] = await Promise.all([
          api.searchIssues(
            { q: q.trim(), limit: ISSUE_LIMIT, include_closed: true },
            { signal: controller.signal },
          ),
          api.searchProjects(
            { q: q.trim(), limit: PROJECT_LIMIT, include_closed: true },
            { signal: controller.signal },
          ),
        ]);
        if (!controller.signal.aborted) {
          setResults({ issues: issueRes.issues, projects: projectRes.projects });
          setIsLoading(false);
        }
      } catch {
        // Abort throws here too; ignore — a newer request is in flight, or
        // the user dismissed the modal. Drift / network errors are already
        // logged inside parseWithFallback + the api logger.
        if (!controller.signal.aborted) setIsLoading(false);
      }
    }, DEBOUNCE_MS);
  }, []);

  const handleChange = useCallback(
    (value: string) => {
      setQuery(value);
      runSearch(value);
    },
    [runSearch],
  );

  // ---- Page + command activation -----------------------------------------
  // Each key maps to the same destination the More tab pushes, so a page row
  // and its nav row can never drift apart.
  const PAGE_PATHS: Record<SearchPageKey, (slug: string) => string> = useMemo(
    () => ({
      inbox: (s) => `/${s}`,
      myIssues: (s) => `/${s}/my-issues`,
      issues: (s) => `/${s}/more/issues`,
      projects: (s) => `/${s}/projects`,
      agents: (s) => `/${s}/more/agents`,
      runtimes: (s) => `/${s}/more/runtimes`,
      skills: (s) => `/${s}/more/skills`,
      settings: (s) => `/${s}/more/settings`,
    }),
    [],
  );

  const navigate = useCallback(
    (path: string) => navigateOnTap(slug, path),
    [slug],
  );

  const onPressPage = useCallback(
    (page: SearchPage) => {
      if (!slug) return;
      navigate(PAGE_PATHS[page.key](slug));
    },
    [PAGE_PATHS, navigate, slug],
  );

  /**
   * Web's command handlers all end in `setOpen(false)` — including the theme
   * switches, where the whole app repainting is the confirmation and leaving
   * the palette up would only delay seeing it. The two creation commands
   * replace the modal with their destination, same as a page row; the theme
   * rows have no destination, so they dismiss back to whatever was under
   * search.
   */
  const onPressCommand = useCallback(
    (key: SearchCommandKey) => {
      switch (key) {
        case "new-issue":
          if (slug) navigate(`/${slug}/new-issue`);
          break;
        case "new-project":
          if (slug) navigate(`/${slug}/project/new`);
          break;
        case "theme-light":
          setPreference("light");
          router.back();
          break;
        case "theme-dark":
          setPreference("dark");
          router.back();
          break;
        case "theme-system":
          setPreference("system");
          router.back();
          break;
      }
    },
    [navigate, setPreference, slug],
  );

  const trimmedQuery = query.trim();
  const filteredMembers = useMemo(
    () => filterMemberMatches(memberRows, trimmedQuery),
    [memberRows, trimmedQuery],
  );

  // The two action groups, already matched against the query.
  // `lib/search-commands.ts` owns the matching rules; this screen owns the
  // labels' translations and the activation handlers.
  const pages = useMemo(
    () => filterSearchPages(buildSearchPages(), query),
    [query],
  );
  const commands = useMemo(
    () => filterSearchCommands(buildSearchCommands(), query),
    [query],
  );

  const hasResults =
    results.issues.length > 0 ||
    results.projects.length > 0 ||
    filteredMembers.length > 0 ||
    pages.length > 0 ||
    commands.length > 0;

  // Build the FlatList data. One flat array of discriminated rows means a
  // single virtualised list covers Recent (empty-state) and the search results
  // without nesting SectionList inside another scroller. Ordering lives in
  // buildSearchRows (lib/search-rows.ts).
  const data = useMemo<RowItem[]>(
    () =>
      buildSearchRows({
        query,
        issues: results.issues,
        projects: results.projects,
        members: filteredMembers,
        recentIssues,
        pages,
        commands,
      }),
    [query, results, filteredMembers, recentIssues, pages, commands],
  );

  const renderItem = useCallback<ListRenderItem<RowItem>>(
    ({ item }) => {
      switch (item.kind) {
        case "header":
          return (
            <Text className="px-4 pt-4 pb-1 text-caption font-medium text-muted-foreground uppercase">
              {item.title}
            </Text>
          );
        case "page":
          return (
            <ActionRow
              icon={<Ionicons name={PAGE_ICONS[item.page.key]} size={18} color={theme.mutedForeground} />}
              label={item.page.label}
              query={item.query}
              onPress={() => onPressPage(item.page)}
            />
          );
        case "command":
          return (
            <ActionRow
              icon={<Ionicons name={COMMAND_ICONS[item.command.key]} size={18} color={theme.mutedForeground} />}
              label={item.command.label}
              query={item.query}
              trailing={
                item.command.theme === themePreference ? (
                  <Ionicons name="checkmark" size={16} color={theme.mutedForeground} />
                ) : null
              }
              onPress={() => onPressCommand(item.command.key)}
            />
          );
        case "issue":
          return <SearchIssueRow item={item.issue} query={item.query} slug={slug} />;
        case "project":
          return <SearchProjectRow item={item.project} query={item.query} slug={slug} />;
        case "member":
          return <SearchMemberRow member={item.member} query={item.query} slug={slug} />;
        case "recent":
          return <RecentRow item={item.issue} slug={slug} />;
      }
    },
    [slug],
  );

  return (
    <SafeAreaView className="flex-1 bg-background" edges={["bottom"]}>
      <KeyboardAvoidingView
        className="flex-1"
        behavior={keyboardBehavior}
      >
        {/* Search input row */}
        <View className="flex-row items-center gap-3 border-b border-border px-4 py-2">
          <Ionicons name="search" size={20} color={theme.mutedForeground} />
          <TextInput
            value={query}
            onChangeText={handleChange}
            placeholder={t("search.placeholder")}
            placeholderTextColor={theme.mutedForeground}
            autoFocus
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            clearButtonMode="while-editing"
            className="flex-1 text-title-sm text-foreground"
          />
        </View>

        {/* Body */}
        <FlatList
          data={data}
          renderItem={renderItem}
          keyExtractor={(item) => item.key}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          ListEmptyComponent={
            isLoading ? (
              <View className="items-center justify-center py-12">
                <ActivityIndicator color={theme.mutedForeground} />
              </View>
            ) : trimmedQuery && !hasResults ? (
              <View className="items-center justify-center py-12 px-6">
                <Text className="text-body text-muted-foreground text-center">
                  {t("search.noResults", { query: trimmedQuery })}
                </Text>
              </View>
            ) : !trimmedQuery && recentIssues.length === 0 ? (
              <View className="items-center justify-center py-12 px-6">
                <Text className="text-body text-muted-foreground text-center">
                  {t("search.empty")}
                </Text>
              </View>
            ) : null
          }
          ListFooterComponent={
            isLoading && hasResults ? (
              <View className="items-center justify-center py-4">
                <ActivityIndicator color={theme.mutedForeground} />
              </View>
            ) : null
          }
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
