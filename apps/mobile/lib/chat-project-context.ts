/**
 * Pure logic for the chat composer's project-context row.
 *
 * Web parity: `packages/views/chat/components/chat-input.tsx` ~590-660 renders
 * a clearable `<ClearablePillButton>` above the editor whenever the session is
 * bound to a project, plus a warning when the bound daemon cannot render the
 * project description into the run brief. On mobile the same three decisions
 * are extracted here so the RN row is a dumb renderer:
 *
 *   - resolveChatProjectContext — does the row render, and what name shows?
 *     Visibility keys off `project_id` alone (so the clear affordance stays
 *     reachable even if the project is missing from the loaded list); the name
 *     is a separate, nullable lookup.
 *   - chatProjectContextSupport / chatProjectContextUnsupported — the SOFT
 *     version gate. Mirrors web's `useChatProjectContextSupport`: `null` means
 *     "cannot tell" (no runtime bound / runtime row not in cache) and must NOT
 *     warn — a spurious warning is worse than a description an old daemon
 *     drops.
 *   - chatProjectPillAccessibilityLabel — composes the fixed action label with
 *     the resolved project name for screen readers.
 *
 * Pure only — no RN / network imports, so the suite runs in Node like the rest
 * of `apps/mobile/lib/*.test.ts`.
 */
import {
  chatProjectContextSupported,
  readRuntimeCliVersion,
} from "@multica/core/runtimes";

/** Minimal project shape this module needs to resolve the chip label. Kept
 *  structural so callers can pass `Project[]` (or a filtered subset) without
 *  importing the data layer here. */
export interface ChatProjectRef {
  id: string;
  title: string;
}

/** Minimal runtime shape this module needs; `RuntimeDevice` satisfies it. */
export interface ChatProjectRuntimeRef {
  metadata?: Record<string, unknown> | null;
}

export interface ChatProjectContext {
  /**
   * 会话是否已绑定项目。未绑定时 row 仍然渲染 —— 否则手机上没有任何入口能给
   * 会话**设置**项目，`project_id` 一旦为空就永远是空的（web 的入口在 add
   * 菜单里，移动端 composer 没有对应菜单，所以把这个入口放在 chip 行上）。
   */
  bound: boolean;
  /** Resolved project title, or null when unset / not in the loaded list. */
  projectName: string | null;
}

/**
 * Resolve the row's render decision and display name in one pass.
 *
 * Web gates the *pill* on the looked-up project (`selectedProject && (...)`),
 * which on mobile would hide the row entirely while the project list is still
 * loading — so we only gate the pill's contents, not the row, on `project_id`.
 * Callers fall back to `t("chat.project.change")` when the name is null.
 */
export function resolveChatProjectContext(
  projectId: string | null | undefined,
  projects: readonly ChatProjectRef[],
): ChatProjectContext {
  if (!projectId) return { bound: false, projectName: null };
  return { bound: true, projectName: resolveChatProjectName(projects, projectId) };
}

/**
 * Look up a project's display title, trimmed. Returns null for an unset id, an
 * id absent from the loaded list (deleted project / list not fetched yet), or a
 * blank title — the caller decides the fallback.
 */
export function resolveChatProjectName(
  projects: readonly ChatProjectRef[],
  projectId: string | null | undefined,
): string | null {
  if (!projectId) return null;
  const title = projects.find((p) => p.id === projectId)?.title;
  if (!title) return null;
  const trimmed = title.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Whether the bound runtime's daemon supports injecting the session's project
 * description into the run brief. Mirrors web's `useChatProjectContextSupport`
 * return contract: `null` = cannot tell (no runtime bound, or the runtime row
 * has not landed in cache), `true` = supported, `false` = too old. The caller
 * resolves the runtime from the active agent's `runtime_id`.
 */
export function chatProjectContextSupport(
  runtime: ChatProjectRuntimeRef | null | undefined,
): boolean | null {
  if (!runtime) return null;
  return chatProjectContextSupported(readRuntimeCliVersion(runtime.metadata ?? undefined));
}

/**
 * Whether to render the "project context unsupported" warning. Only a positive
 * `false` from the support gate warns; `null` (cannot tell) stays quiet — the
 * same soft-gate policy as web's `projectContextSupport === false`.
 */
export function chatProjectContextUnsupported(
  runtime: ChatProjectRuntimeRef | null | undefined,
): boolean {
  return chatProjectContextSupport(runtime) === false;
}

/**
 * Screen-reader label for the pill body: the fixed "change project" action,
 * qualified with the project name when one resolved. Uses only the existing
 * `chat.project.change` catalog key, so no new i18n entry is needed.
 */
export function chatProjectPillAccessibilityLabel(
  projectName: string | null,
  translate: (id: string) => string,
): string {
  const action = translate("chat.project.change");
  return projectName ? `${action}: ${projectName}` : action;
}
