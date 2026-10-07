/**
 * Pages + Commands groups for the workspace search panel.
 *
 * Web's Cmd+K palette (`packages/views/search/search-command.tsx`) renders
 * seven groups; mobile's search screen shipped only the four data groups
 * (members / projects / issues / cancelled) — `lib/search-rows.ts` recorded
 * the omission in passing ("between the (absent) web Pages/Commands and the
 * Projects section"). This module ports the two absent groups.
 *
 * Why they matter: they are the only way a keyboard-less user reaches a
 * destination without walking the More tab. Web types `set` and lands in
 * Settings; mobile had to tap More → Settings. Same device, same account,
 * 3-6 taps rather than 1.
 *
 * No React / i18n-react imports: this module runs in the Node vitest lane and
 * takes its strings through `translate()`.
 */
import { translate } from "./i18n";

export type SearchPageKey =
  | "inbox"
  | "myIssues"
  | "issues"
  | "projects"
  | "agents"
  | "runtimes"
  | "skills"
  | "settings";

export interface SearchPage {
  key: SearchPageKey;
  /** Already-translated label, matched by `matchesEntry` like web does. */
  label: string;
  /** Same role as web's `NavPage.keywords` — extra needles, per locale. */
  keywords: string[];
}

export type SearchCommandKey =
  | "new-issue"
  | "new-project"
  | "theme-light"
  | "theme-dark"
  | "theme-system";

export interface SearchCommand {
  key: SearchCommandKey;
  label: string;
  keywords: string[];
  /** For the three theme rows: the preference this row selects. */
  theme?: "light" | "dark" | "system";
}

/**
 * Web's `navPages` (`search-command.tsx:245-254`). The label is read through
 * the same `nav.*` keys the More tab and the sidebar use, so a destination
 * can never be named two different things in one app — web derives its page
 * icon from the route for the same reason.
 *
 * Keywords are bilingual on purpose (web carries `收件箱` / `我的` / `项目` /
 * `设置` alongside the English words): the zh label for Agents is 智能体, and
 * a reader who thinks in English still expects `agent` to find it.
 */
export function buildSearchPages(): SearchPage[] {
  return [
    {
      key: "inbox",
      label: translate("nav.inbox"),
      keywords: ["inbox", "notifications", "收件箱", "通知"],
    },
    {
      key: "myIssues",
      label: translate("nav.myIssues"),
      keywords: ["my", "issues", "assigned", "我的"],
    },
    {
      key: "issues",
      label: translate("nav.issues"),
      keywords: ["issues", "tasks", "bugs", "任务"],
    },
    {
      key: "projects",
      label: translate("nav.projects"),
      keywords: ["projects", "kanban", "项目"],
    },
    {
      key: "agents",
      label: translate("nav.agents"),
      keywords: ["agents", "bots", "ai", "智能体"],
    },
    {
      key: "runtimes",
      label: translate("nav.runtimes"),
      keywords: ["runtimes", "environments", "运行时"],
    },
    {
      key: "skills",
      label: translate("nav.skills"),
      keywords: ["skills", "library", "技能"],
    },
    {
      key: "settings",
      // `screen.settings`, not `nav.more`: the row is a destination called
      // "Settings", whereas More names the phone's container for it. Every
      // other row here is a destination, so this one is too.
      label: translate("screen.settings"),
      keywords: ["settings", "config", "preferences", "设置"],
    },
  ];
}

/**
 * Web's `commands` memo (`search-command.tsx:324-460`), minus the branches
 * that mobile's search screen cannot reach.
 *
 * Web gates its four issue-scoped rows (`copy-issue-link` /
 * `copy-issue-identifier` / `fold-all-comments` / `unfold-all-comments`) on
 * `currentIssueId`, parsed out of a `/{slug}/issues/{id}` route. Mobile's
 * search screen is only reachable from the Inbox and My Issues headers
 * (`components/ui/app-header-actions.tsx` is mounted on those two tabs and
 * nowhere else), so that predicate is always false there and porting the four
 * rows would add four permanently-dead entries. They are deliberately left
 * out rather than stubbed; if search later gains a header on the issue
 * detail page, these four come back with the same `hasIssue` gate.
 *
 * Not ported, same reasoning: web's `resolveClickIntent` (cmd+click opens a
 * result in a new tab) has no mobile analogue.
 */
export function buildSearchCommands(): SearchCommand[] {
  return [
    {
      key: "new-issue",
      label: translate("screen.newIssue"),
      keywords: ["new", "issue", "create", "add", "新建任务"],
    },
    {
      key: "new-project",
      label: translate("screen.newProject"),
      keywords: ["new", "project", "create", "add", "新建项目"],
    },
    {
      key: "theme-light",
      label: translate("search.commands.switchToLight"),
      keywords: ["light", "theme", "appearance", "mode", "bright", "浅色"],
      theme: "light",
    },
    {
      key: "theme-dark",
      label: translate("search.commands.switchToDark"),
      keywords: ["dark", "theme", "appearance", "mode", "night", "深色"],
      theme: "dark",
    },
    {
      key: "theme-system",
      label: translate("search.commands.useSystemTheme"),
      keywords: ["system", "theme", "appearance", "mode", "auto", "跟随系统"],
      theme: "system",
    },
  ];
}

/**
 * Web's match rule, shared by both groups (`search-command.tsx:301-310` for
 * pages, `:470-474` for commands): a needle hits the label or any keyword,
 * case-insensitively. Keywords are not lowercased at rest — the CJK ones have
 * no case — so the needle carries the lowering for both sides.
 */
export function matchesEntry(
  entry: { label: string; keywords: string[] },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  return (
    entry.label.toLowerCase().includes(q) ||
    entry.keywords.some((kw) => kw.toLowerCase().includes(q))
  );
}

/** Pages for the current query. An empty query yields none — web reserves
 *  the empty panel for Recent (`search-command.tsx:299-300`). */
export function filterSearchPages(
  pages: readonly SearchPage[],
  query: string,
): SearchPage[] {
  return pages.filter((page) => matchesEntry(page, query));
}

/**
 * Commands for the current query. Mirrors web's asymmetry
 * (`search-command.tsx:465-476`): with no query only the primary creation
 * action survives, because the empty-state space belongs to Recent; once the
 * reader types, every command is reachable by keyword.
 */
export function filterSearchCommands(
  commands: readonly SearchCommand[],
  query: string,
): SearchCommand[] {
  const q = query.trim();
  if (!q) return commands.filter((c) => c.key === "new-issue");
  return commands.filter((command) => matchesEntry(command, q));
}
