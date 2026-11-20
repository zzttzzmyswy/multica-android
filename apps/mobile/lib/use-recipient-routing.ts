/**
 * Recipient routing for one composer — the phone half of web's
 * `use-recipient-actions.ts`.
 *
 * Web derives each recipient's live run from `issueTasksOptions(issueId)` and
 * turns the user's per-recipient choice into the three submit lists
 * (`suppress_agent_ids` / `steer_task_ids` / the turns to stop first). Mobile
 * had the preview chips but only a binary skip toggle, so a comment written to
 * correct a running agent silently queued a follow-up run behind it.
 *
 * Behaviour mirrored one-for-one from `packages/views/issues/hooks/
 * use-recipient-actions.ts`; the parts that had to change for the phone are
 * called out inline.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { AgentTask, CommentTriggerPreviewAgent } from "@multica/core/types";
import { issueTasksOptions } from "@/data/queries/issues";
import { useWorkspaceStore } from "@/data/workspace-store";
import {
  agentRunState,
  attachmentsBlockSteer as computeAttachmentsBlockSteer,
  isActiveTask,
  pruneRecipientChoices,
  recipientActions,
  recipientRouting,
  resolveRecipientAction,
  type AgentRunState,
  type RecipientAction,
  type RecipientRouting,
} from "@/lib/recipient-routing";

const NO_TASKS: AgentTask[] = [];
const NO_CHOICES: Record<string, RecipientAction> = {};

export interface RecipientEntry {
  agent: CommentTriggerPreviewAgent;
  state: AgentRunState;
  /** The action Send will take for this recipient. */
  action: RecipientAction;
  /** The actions its menu may offer, in display order. */
  actions: RecipientAction[];
}

export interface UseRecipientRoutingArgs {
  issueId: string;
  /** Recipients the trigger preview returned. */
  agents: CommentTriggerPreviewAgent[];
  /**
   * Whether a running turn takes this message BY CHOICE, so a `steer` is
   * offered as the default for it. Web passes a predicate: a top-level
   * comment steers an assignment run (one with no trigger comment) and a
   * thread reply steers the run that belongs to that thread.
   */
  steerByDefault: (task: AgentTask) => boolean;
  /** False for an edit: an edit never steers and never stops a run. */
  allowSteer?: boolean;
  allowRestart?: boolean;
  /** True while the draft holds an attachment — a running turn takes text
   *  only, so steering becomes unavailable and the notice is shown. */
  hasAttachments?: boolean;
}

export function useRecipientRouting({
  issueId,
  agents,
  steerByDefault,
  allowSteer = true,
  allowRestart = true,
  hasAttachments = false,
}: UseRecipientRoutingArgs) {
  const wsId = useWorkspaceStore((s) => s.currentWorkspaceId);
  const [chosen, setChosen] = useState<Record<string, RecipientAction>>(NO_CHOICES);

  // Read only the active runs of THIS composer's recipients. A comment row
  // mounts its own edit composer, and subscribing to the whole issue's task
  // list would re-render every row on every unrelated run event — the reason
  // web narrows with `select` too. Mobile's query is workspace-scoped, so the
  // filter is the only thing keeping the row count down.
  const agentKey = agents.map((agent) => agent.id).join(",");
  const selectActive = useCallback(
    (all: AgentTask[]) => {
      const ids = new Set(agentKey.split(","));
      return all.filter((task) => ids.has(task.agent_id) && isActiveTask(task));
    },
    [agentKey],
  );
  const { data: tasks = NO_TASKS } = useQuery({
    ...issueTasksOptions(wsId, issueId),
    enabled: !!issueId && agents.length > 0,
    select: selectActive,
  });

  // Forget a choice whose recipient is no longer in the draft (an @mention
  // was edited away). Without this a stale "skip" would suppress an agent the
  // user has re-mentioned, and a stale "steer" would point at a turn they are
  // no longer addressing.
  useEffect(() => {
    setChosen((prev) => {
      const next = pruneRecipientChoices(prev, agents.map((a) => a.id));
      return next === prev ? prev : next;
    });
  }, [agents]);

  const recipients = useMemo<RecipientEntry[]>(
    () =>
      agents.map((agent) => {
        const state = agentRunState(tasks, agent.id);
        const opts = {
          // Files cannot enter a running turn, and an edit must not steer.
          canSteer: allowSteer && !hasAttachments,
          canRestart: allowRestart,
          // The default only applies to a running turn the caller claims.
          steerByDefault: state.kind === "running" && steerByDefault(state.task),
        };
        return {
          agent,
          state,
          action: resolveRecipientAction(state, chosen[agent.id], opts),
          actions: recipientActions(state, opts),
        };
      }),
    [agents, tasks, chosen, allowSteer, allowRestart, hasAttachments, steerByDefault],
  );

  const routing = useMemo<RecipientRouting>(
    () =>
      recipientRouting(
        recipients.map((r) => ({
          agentId: r.agent.id,
          action: r.action,
          state: r.state,
        })),
      ),
    [recipients],
  );

  const attachmentsBlockSteer = useMemo(
    () =>
      computeAttachmentsBlockSteer(
        recipients.map((r) => ({
          agentId: r.agent.id,
          action: r.action,
          state: r.state,
        })),
        hasAttachments,
        allowSteer,
      ),
    [recipients, hasAttachments, allowSteer],
  );

  const setAction = useCallback(
    (agentId: string, action: RecipientAction) => {
      setChosen((prev) =>
        prev[agentId] === action ? prev : { ...prev, [agentId]: action },
      );
    },
    [],
  );

  const reset = useCallback(() => setChosen(NO_CHOICES), []);

  return { recipients, routing, attachmentsBlockSteer, setAction, reset };
}

/**
 * "Stop and start over": the chosen turns are stopped BEFORE the comment is
 * posted, so the message starts a fresh run instead of waiting behind them.
 *
 * Resolves false when a turn could not be stopped, and the caller must keep
 * the draft — posting anyway would deliver the message to a run that is still
 * going, which is the exact thing the user asked not to happen. Mirrors web's
 * `useStopRunsBeforeSend`.
 */
export function useStopRunsBeforeSend(
  stop: (taskId: string) => Promise<unknown>,
): (taskIds: string[]) => Promise<boolean> {
  return useCallback(
    async (taskIds: string[]): Promise<boolean> => {
      if (taskIds.length === 0) return true;
      try {
        await Promise.all(taskIds.map((taskId) => stop(taskId)));
        return true;
      } catch {
        return false;
      }
    },
    [stop],
  );
}

/**
 * Web's top-level default: an assignment run (no trigger comment) takes a
 * top-level comment; a run that was itself started by a comment in some
 * thread belongs to that thread, so a top-level comment only reaches it by
 * choice.
 */
export function steerTopLevelByDefault(task: AgentTask): boolean {
  return !task.trigger_comment_id;
}

/** A thread reply steers only the turn that belongs to that thread. */
export function steerThreadRunByDefault(
  threadTaskIds: ReadonlySet<string>,
): (task: AgentTask) => boolean {
  return (task) => threadTaskIds.has(task.id);
}

export const NEVER_STEER_BY_DEFAULT = () => false;
