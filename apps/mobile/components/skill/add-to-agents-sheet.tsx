/**
 * "Add to agent" picker — the one implementation behind both entry points the
 * skills LIST grew: the row kebab (iteration 230, MYS-2097) and the batch bar
 * (MYS-1156).
 *
 * Both used to need their own copy of the same sheet — same agent split, same
 * already-bound filter, same attach plan — which is exactly the fork
 * `apps/mobile/CLAUDE.md` Principle 1 exists to prevent. The batch bar's copy
 * was already the generalised one (`planSkillAttach`, which skips targets that
 * already hold every selected skill), so it moved here and the kebab reuses it.
 *
 * The skill DETAIL page keeps its own sheet: it is not a third copy of this
 * one. It lists the skill's `used_by` set rather than a directory minus the
 * bound rows, subtitles each row with the agent's description rather than the
 * partial-overlap count, and awaits its attaches serially so the first failure
 * can be reported per target. Folding it in would have meant three behaviour
 * changes on a surface this round did not set out to touch.
 *
 * Permission shape is web's (`AddToAgentDialog` in
 * `packages/views/skills/components/skill-list-actions.tsx:69-106`): attaching
 * is gated by the TARGET agent, not by edit rights on the skill, so a member
 * sees their own agents and a workspace admin also sees everyone else's. The
 * sheet does the filtering; the caller passes the whole directory.
 *
 * Feedback is deliberately NOT owned here: the batch bar reports through its
 * in-bar toast, a row reports through a native Alert, and the detail page
 * through its own Alert — three surfaces with three established channels. The
 * caller gets the settled `BatchOutcome` and words it.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Agent, SkillSummary } from "@multica/core/types";
import { ActorAvatar } from "@/components/ui/actor-avatar";
import { MultiSelectSheet } from "@/components/agent/multi-select-sheet";
import { agentListOptions } from "@/data/queries/agents";
import { useBatchAddSkillsToAgents } from "@/data/mutations/skills";
import { useWorkspaceStore } from "@/data/workspace-store";
import { useAuthStore } from "@/data/auth-store";
import { catalogRead } from "@/lib/catalog-read";
import { useSkillRole } from "@/lib/use-skill-role";
import { missingSkillIds, planSkillAttach, toggleId, type BatchOutcome } from "@/lib/skill-batch";
import { useTranslation } from "@/lib/i18n/react";

export function AddToAgentsSheet({
  visible,
  skills,
  onClose,
  onResult,
  onError,
}: {
  visible: boolean;
  /** The skills being attached — one from a row kebab, N from the batch bar. */
  skills: SkillSummary[];
  /** Dismiss the sheet. Called before any write, and again after one lands. */
  onClose: () => void;
  /** The settled outcome of the attach, for the caller to word. Not called
   *  when the plan was empty (nothing was requested). */
  onResult?: (outcome: BatchOutcome) => void;
  /** A rejected request. `useBatchAddSkillsToAgents` runs its targets through
   *  `allSettled` and so resolves with per-target failures instead of
   *  rejecting, which is why `onResult` carries the common case — but a
   *  payment for that guarantee is a rejection path that must still be
   *  reportable rather than swallowed. */
  onError?: (error: unknown) => void;
}) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const userId = useAuthStore((s) => s.user?.id);
  const role = useSkillRole(wsId);
  const { t } = useTranslation();

  const agentsRead = catalogRead(useQuery(agentListOptions(wsId)));
  const agents = agentsRead.items;
  const batchAttach = useBatchAddSkillsToAgents();

  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(
    new Set(),
  );

  // Keyed on the ids themselves, not the `skills` array's identity: a caller
  // that builds `[row.skill]` inline (the list's kebab does) hands over a new
  // array on every render, which would recompute both memos below on every
  // frame. The ids are what the memos actually depend on.
  const idKey = skills.map((s) => s.id).join("\u0000");
  const skillIds = useMemo(
    () => (idKey.length === 0 ? [] : idKey.split("\u0000")),
    [idKey],
  );
  const count = skillIds.length;

  // A closed sheet drops its pending selection: a kebab opened twice must not
  // carry the previous agent choice into the second write.
  useEffect(() => {
    if (!visible) setSelectedIds(new Set());
  }, [visible]);

  /**
   * "My agents" / "Other agents" buckets, minus the targets that already hold
   * every selected skill (nothing to send — the attach endpoint is additive,
   * so those rows are a no-op rather than an error). A partial overlap stays
   * selectable and says how much of the selection is already there.
   */
  const groups = useMemo(() => {
    const active = agents.filter((a) => !a.archived_at);
    const isAdmin = role === "owner" || role === "admin";
    const mine = active.filter(
      (a) => a.owner_id !== null && a.owner_id === userId,
    );
    const others = isAdmin
      ? active.filter((a) => a.owner_id === null || a.owner_id !== userId)
      : [];
    const toRow = (agent: Agent) => {
      const owned = count - missingSkillIds(agent, skillIds).length;
      return {
        key: agent.id,
        title: agent.name,
        subtitle:
          owned > 0
            ? t("skills.batch.partial", { owned, total: count })
            : undefined,
      };
    };
    return [
      {
        label: t("skills.usedBy.mine"),
        rows: mine
          .filter((a) => missingSkillIds(a, skillIds).length > 0)
          .map(toRow),
      },
      {
        label: t("skills.usedBy.others"),
        rows: others
          .filter((a) => missingSkillIds(a, skillIds).length > 0)
          .map(toRow),
      },
    ];
  }, [agents, role, userId, skillIds, count, t]);

  const confirm = () => {
    const plan = planSkillAttach(agents, [...selectedIds], skillIds);
    onClose();
    if (plan.length === 0) return;
    batchAttach.mutate(plan, {
      onSuccess: (outcome) => onResult?.(outcome),
      onError: (err) => onError?.(err),
    });
  };

  return (
    <MultiSelectSheet
      visible={visible}
      title={t("skills.usedBy.addTitle")}
      groups={groups}
      state={agentsRead.state}
      onRetry={agentsRead.retry}
      searchPlaceholder={t("skills.usedBy.searchPlaceholder")}
      selectedKeys={selectedIds}
      emptyText={t("skills.usedBy.noAgents")}
      noMatchText={t("skills.usedBy.noMatch")}
      leading={(row) => <ActorAvatar type="agent" id={row.key} size={28} />}
      onToggle={(key) => setSelectedIds((prev) => toggleId(prev, key))}
      onClose={confirm}
    />
  );
}
