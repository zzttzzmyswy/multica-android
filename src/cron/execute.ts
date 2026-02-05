/**
 * Cron Job Execution
 *
 * Handles the actual execution of cron job payloads.
 * Based on OpenClaw's implementation (MIT License)
 */

import type { CronJob } from "./types.js";
import { getHub, isHubInitialized } from "../hub/hub-singleton.js";

/** Execution result */
export type ExecutionResult = {
  summary?: string;
  error?: string;
};

/**
 * Execute a cron job payload.
 *
 * For system-event: Injects text into the main session
 * For agent-turn: Creates an isolated agent turn
 */
export async function executeCronJob(job: CronJob): Promise<ExecutionResult> {
  const { payload } = job;

  switch (payload.kind) {
    case "system-event":
      return executeSystemEvent(job);
    case "agent-turn":
      return executeAgentTurn(job);
    default:
      return { error: `Unknown payload kind: ${(payload as { kind: string }).kind}` };
  }
}

/**
 * Execute a system-event payload.
 * Injects the text into the main session as a system message.
 */
async function executeSystemEvent(job: CronJob): Promise<ExecutionResult> {
  if (!isHubInitialized()) {
    return { error: "Hub not available" };
  }
  const hub = getHub();

  const payload = job.payload as { kind: "system-event"; text: string };

  // Get the list of active agents
  const agentIds = hub.listAgents();
  if (agentIds.length === 0) {
    return { error: "No active agents" };
  }

  // For now, inject into the first (main) agent
  // TODO: Support targeting specific agent by ID
  const agentId = agentIds[0]!;
  const agent = hub.getAgent(agentId);
  if (!agent || agent.closed) {
    return { error: `Agent ${agentId} not found or closed` };
  }

  // Format the cron message with metadata
  const cronMessage = `[CRON] ${job.name}: ${payload.text}`;

  try {
    // Write to agent (non-blocking, will be processed in queue)
    agent.write(cronMessage);

    // Wait for the agent to process the message
    await agent.waitForIdle();

    return { summary: `Injected message into agent ${agentId.slice(0, 8)}` };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute an agent-turn payload.
 * Creates an isolated subagent to run the task.
 */
async function executeAgentTurn(job: CronJob): Promise<ExecutionResult> {
  if (!isHubInitialized()) {
    return { error: "Hub not available" };
  }
  const hub = getHub();

  const payload = job.payload as {
    kind: "agent-turn";
    message: string;
    model?: string;
    thinkingLevel?: string;
    timeoutSeconds?: number;
  };

  // Generate a unique session ID for this isolated run
  const sessionId = `cron-${job.id}-${Date.now()}`;

  try {
    // Create isolated subagent
    // TODO: Support model/thinkingLevel override
    const agent = hub.createSubagent(sessionId, {
      profileId: "default",
    });

    // Set up timeout if specified
    const timeoutMs = (payload.timeoutSeconds ?? 300) * 1000; // default 5 minutes
    let timeoutHandle: NodeJS.Timeout | undefined;

    const timeoutPromise = new Promise<ExecutionResult>((_, reject) => {
      timeoutHandle = setTimeout(() => {
        reject(new Error(`Cron job timed out after ${payload.timeoutSeconds}s`));
      }, timeoutMs);
    });

    // Execute the agent turn
    const executePromise = (async (): Promise<ExecutionResult> => {
      const cronMessage = `[CRON Job: ${job.name}]\n\n${payload.message}`;
      agent.write(cronMessage);
      await agent.waitForIdle();
      return { summary: `Completed agent turn in isolated session ${sessionId.slice(0, 16)}` };
    })();

    // Race between execution and timeout
    const result = await Promise.race([executePromise, timeoutPromise]);

    // Clear timeout
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }

    // Close the subagent
    agent.close();

    return result;
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
