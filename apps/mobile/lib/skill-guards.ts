/**
 * Skill permission + provenance guards, extracted into pure functions so the
 * workspace-admin rule and the origin-tag mapping are unit-testable without a
 * device/second-member setup.
 *
 * Mirrors web:
 *   - canEditSkill: packages/views/skills/hooks/use-can-edit-skill.ts — a
 *     workspace admin/owner can edit any skill; everyone else only skills
 *     they created. The server enforces this independently; the guard only
 *     decides whether the mobile UI shows the actions.
 *   - readOrigin: packages/views/skills/lib/origin.ts — the discriminated
 *     view over `Skill.config.origin`; manual creates have no origin, so we
 *     synthesize `manual` to keep consumers uniform.
 */
import type { MemberRole, SkillSummary } from "@multica/core/types";

/** The provenance types the backend writes into `config.origin.type`. */
export type SkillOriginType =
  | "runtime_local"
  | "clawhub"
  | "skills_sh"
  | "github"
  | "manual";

export interface OriginInfo {
  type: SkillOriginType;
  /** Upstream URL a refresh re-downloads from. Only hosted origins set it. */
  source_url?: string;
}

/** i18n key for each origin badge (flat keys — see lib/i18n/locales). */
export const ORIGIN_LABEL_KEY: Record<SkillOriginType, string> = {
  runtime_local: "skills.origin.runtimeLocal",
  clawhub: "skills.origin.clawhub",
  skills_sh: "skills.origin.skillsSh",
  github: "skills.origin.github",
  manual: "skills.origin.manual",
};

export function canEditSkill(
  skill: SkillSummary | null | undefined,
  opts: { userId: string | null | undefined; role: MemberRole | null | undefined },
): boolean {
  if (!skill) return false;
  if (opts.role === "admin" || opts.role === "owner") return true;
  return skill.created_by === opts.userId;
}

/** Read the skill's provenance; anything unknown/missing collapses to manual. */
export function readOrigin(skill: SkillSummary): OriginInfo {
  const raw = skill.config?.origin;
  if (raw && typeof raw === "object" && "type" in raw) {
    const origin = raw as { type?: unknown; source_url?: unknown };
    const type = origin.type;
    if (
      type === "runtime_local" ||
      type === "clawhub" ||
      type === "skills_sh" ||
      type === "github"
    ) {
      const info: OriginInfo = { type };
      if (typeof origin.source_url === "string" && origin.source_url.length > 0) {
        info.source_url = origin.source_url;
      }
      return info;
    }
  }
  return { type: "manual" };
}

/**
 * Whether the skill can be re-downloaded from where it was imported. Only
 * hosted sources qualify: runtime-local copies re-import through the daemon,
 * and manual / archive-uploaded skills have no upstream at all. The server
 * enforces the same rule on `POST /api/skills/:id/refresh`.
 */
export function isRefreshableOrigin(origin: OriginInfo): boolean {
  return (
    (origin.type === "github" ||
      origin.type === "skills_sh" ||
      origin.type === "clawhub") &&
    typeof origin.source_url === "string" &&
    origin.source_url.length > 0
  );
}

/** Full skill payload (detail endpoint) — SKILL.md body + attached files. */
export type { Skill } from "@multica/core/types";