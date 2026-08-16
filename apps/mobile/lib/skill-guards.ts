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
    const type = (raw as { type?: unknown }).type;
    if (
      type === "runtime_local" ||
      type === "clawhub" ||
      type === "skills_sh" ||
      type === "github"
    ) {
      return { type };
    }
  }
  return { type: "manual" };
}

/** Full skill payload (detail endpoint) — SKILL.md body + attached files. */
export type { Skill } from "@multica/core/types";