import { Agent as PiAgentCore, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import type { UserMessage } from "@mariozechner/pi-ai";
import { v7 as uuidv7 } from "uuid";
import type { AgentOptions, AgentRunResult, ReasoningMode } from "./types.js";
import type { MulticaEvent, CompactionEndEvent } from "./events.js";
import { createAgentOutput } from "./cli/output.js";
import { resolveModel, resolveTools, type ResolveToolsOptions } from "./tools.js";
import {
  resolveApiKey,
  resolveApiKeyForProfile,
  resolveApiKeyForProvider,
  resolveBaseUrl,
  resolveModelId,
  PROVIDER_ALIAS,
  getDefaultModel,
} from "./providers/index.js";
import { SessionManager } from "./session/session-manager.js";
import type { SessionMeta } from "./session/types.js";
import { ProfileManager } from "./profile/index.js";
import { SkillManager } from "./skills/index.js";
import { credentialManager, getCredentialsPath } from "./credentials.js";
import {
  checkContextWindow,
  DEFAULT_CONTEXT_TOKENS,
  type ContextWindowGuardResult,
  estimateTokenUsage,
  COMPACTION_TRIGGER_RATIO,
  compactMessagesTokenAware,
  MIN_KEEP_MESSAGES,
} from "./context-window/index.js";
import { mergeToolsConfig, type ToolsConfig } from "./tools/policy.js";
import {
  loadAuthProfileStore,
  resolveAuthProfileOrder,
  isProfileInCooldown,
  markAuthProfileFailure,
  markAuthProfileUsed,
  markAuthProfileGood,
} from "./auth-profiles/index.js";
import {
  buildSystemPrompt as buildStructuredSystemPrompt,
  collectRuntimeInfo,
  type SystemPromptMode,
} from "./system-prompt/index.js";
import type { AuthProfileFailureReason } from "./auth-profiles/index.js";
import {
  sanitizeToolCallInputs,
  sanitizeToolUseResultPairing,
} from "./session/session-transcript-repair.js";
import { isContextOverflowError } from "./errors.js";
import { resolveWorkspaceDir, ensureWorkspaceDir } from "./workspace.js";
import { createRunLog, type RunLog } from "./run-log.js";
import type { ExecApprovalCallback } from "./tools/exec-approval-types.js";

// ============================================================
// Error classification for auth profile rotation
// ============================================================

/** Classify an error into an auth profile failure reason */
export function classifyError(error: unknown): AuthProfileFailureReason {
  const msg = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

  if (msg.includes("401") || msg.includes("403") || msg.includes("unauthorized") || msg.includes("invalid api key") || msg.includes("authentication")) {
    return "auth";
  }
  if (msg.includes("400") || msg.includes("invalid request") || msg.includes("malformed") || msg.includes("bad request") || msg.includes("schema")) {
    return "format";
  }
  if (msg.includes("429") || msg.includes("rate limit") || msg.includes("rate_limit") || msg.includes("too many requests")) {
    return "rate_limit";
  }
  if (msg.includes("billing") || msg.includes("quota") || msg.includes("insufficient") || msg.includes("payment")) {
    return "billing";
  }
  if (msg.includes("timeout") || msg.includes("timed out") || msg.includes("econnreset") || msg.includes("etimedout")) {
    return "timeout";
  }
  return "unknown";
}

/** Check if an error is potentially retryable via profile rotation */
export function isRotatableError(reason: AuthProfileFailureReason): boolean {
  // timeout is rotatable because some providers hang on rate limit instead of returning 429
  return reason === "auth" || reason === "rate_limit" || reason === "billing" || reason === "timeout";
}

// ── Skill install consent guard ─────────────────────────────────────────────

const CLAWHUB_MUTATION_RE = /\bclawhub\b[\s\S]*\b(?:install|update)\b/i;
const ENV_INSTALL_RE = /\b(?:brew|apt-get|apt|yum|dnf|pacman|zypper)\s+(?:install|upgrade|tap)\b|\b(?:npm|pnpm|yarn|bun)\s+(?:install|add)\b|\bpip(?:3)?\s+install\b|\buv\s+(?:tool\s+install|pip\s+install)\b|\bcargo\s+install\b|\bgo\s+install\b/i;
const THIRD_PARTY_WORKAROUND_RE = /\b(?:osascript|spogo|spotify_player|ha\.sh|homeassistant|hass)\b|\/api\/states\b/i;
const LOCAL_SKILL_PATH_RE = /(?:~\/\.super-multica(?:-[\w-]+)?\/skills\/|\/\.super-multica(?:-[\w-]+)?\/skills\/|\/skills\/)/i;
const LOCAL_SKILL_MUTATION_VERB_RE = /\b(?:mkdir|cp|mv|rm|touch|install|clone)\b/i;
const INSTALL_ACTION_RE = /\b(?:install|update|add)\b|安装|更新|添加|启用|配置/i;
const SKILL_CONTEXT_RE = /\b(?:clawhub|skill|skills)\b|技能|插件|扩展/i;
const WORKAROUND_ACTION_RE = /\b(?:workaround|fallback|local\s+command|local\s+script|shell\s+script|osascript|apple\s*script|spogo|spotify_player|homeassistant|ha\.sh)\b|绕过|临时方案|本地命令|本机命令|脚本方式|直接执行|不用技能|不用skill|不装skill|不安装skill/i;
const CUSTOM_SKILL_AUTHORING_RE = /\b(?:create|author|build)\b[\s\S]*\bskills?\b|创建[\s\S]{0,30}(?:技能|skill)|自定义[\s\S]{0,20}(?:技能|skill)|手写[\s\S]{0,20}(?:技能|skill)|custom\s+skill/i;
const AFFIRMATIVE_RE = /\b(?:yes|y|ok|okay|sure|confirm|confirmed|continue|go ahead|please do|do it)\b|继续|确认|同意|可以|好的|继续安装/i;
const STANDALONE_AFFIRMATIVE_RE = /^\s*(?:行|行吧|行的)\s*[。！!]?$/i;
const DECLINE_RE = /\b(?:no|cancel|stop|don't|do not|not now|skip)\b|不要|不需要|取消|先别|暂时不用/i;

function hasAffirmativeConsent(text: string): boolean {
  return AFFIRMATIVE_RE.test(text) || STANDALONE_AFFIRMATIVE_RE.test(text);
}

/**
 * Detect mutating ClawHub commands that require explicit user confirmation.
 */
export function isMutatingClawhubCommand(command: string): boolean {
  return CLAWHUB_MUTATION_RE.test(command);
}

/**
 * Detect package/environment installation commands.
 * These mutate the runtime environment and should require explicit user confirmation.
 */
export function isEnvironmentInstallCommand(command: string): boolean {
  return ENV_INSTALL_RE.test(command);
}

/**
 * Detect local workaround commands for third-party integrations.
 * These should require explicit user opt-in before execution.
 */
export function isThirdPartyWorkaroundCommand(command: string): boolean {
  return THIRD_PARTY_WORKAROUND_RE.test(command);
}

/**
 * Detect direct local skill mutations outside ClawHub install/update flow.
 */
export function isLocalSkillMutationCommand(command: string): boolean {
  if (!LOCAL_SKILL_PATH_RE.test(command)) return false;
  if (/\bclawhub\b/i.test(command)) return false;

  if (LOCAL_SKILL_MUTATION_VERB_RE.test(command)) return true;

  const hasCatOrEchoWrite = /\b(?:cat|tee|echo)\b/i.test(command) && />>?|<<\s*['"]?EOF/i.test(command);
  return hasCatOrEchoWrite;
}

/**
 * Determine whether the current user prompt grants permission to install/update skills.
 *
 * If `awaitingConfirmation` is true, short affirmative replies (e.g. "继续", "yes")
 * are treated as confirmation.
 */
export function evaluateSkillInstallConsent(
  prompt: string,
  awaitingConfirmation: boolean,
): { allowInstall: boolean; declined: boolean } {
  const text = prompt.trim();
  if (!text) return { allowInstall: false, declined: false };

  if (DECLINE_RE.test(text)) {
    return { allowInstall: false, declined: true };
  }

  const hasInstallAction = INSTALL_ACTION_RE.test(text);
  const hasSkillContext = SKILL_CONTEXT_RE.test(text);
  const hasAffirmative = hasAffirmativeConsent(text);

  if (hasInstallAction) {
    return { allowInstall: true, declined: false };
  }

  if (hasSkillContext && hasAffirmative) {
    return { allowInstall: true, declined: false };
  }

  if (awaitingConfirmation && hasAffirmative) {
    return { allowInstall: true, declined: false };
  }

  return { allowInstall: false, declined: false };
}

/**
 * Determine whether the current user prompt explicitly opts into local workaround mode.
 */
export function evaluateWorkaroundConsent(
  prompt: string,
  awaitingConfirmation: boolean,
): { allowWorkaround: boolean; declined: boolean } {
  const text = prompt.trim();
  if (!text) return { allowWorkaround: false, declined: false };

  const hasWorkaroundAction = WORKAROUND_ACTION_RE.test(text);
  const hasAffirmative = hasAffirmativeConsent(text);

  if (hasWorkaroundAction) {
    return { allowWorkaround: true, declined: false };
  }

  if (awaitingConfirmation && hasAffirmative) {
    return { allowWorkaround: true, declined: false };
  }

  if (DECLINE_RE.test(text)) {
    return { allowWorkaround: false, declined: true };
  }

  return { allowWorkaround: false, declined: false };
}

/**
 * Determine whether the current prompt explicitly opts into custom skill authoring.
 */
export function evaluateCustomSkillAuthoringConsent(
  prompt: string,
  awaitingConfirmation: boolean,
): { allowAuthoring: boolean; declined: boolean } {
  const text = prompt.trim();
  if (!text) return { allowAuthoring: false, declined: false };

  if (DECLINE_RE.test(text)) {
    return { allowAuthoring: false, declined: true };
  }

  const hasAuthoringIntent = CUSTOM_SKILL_AUTHORING_RE.test(text);
  const hasAffirmative = hasAffirmativeConsent(text);

  if (hasAuthoringIntent) {
    return { allowAuthoring: true, declined: false };
  }

  if (awaitingConfirmation && hasAffirmative) {
    return { allowAuthoring: true, declined: false };
  }

  return { allowAuthoring: false, declined: false };
}

/**
 * Infer whether a tool call should be classified as error in run-log.
 *
 * Some tool adapters encode failures in payload fields (`error`, `error_type`)
 * without setting `event.isError=true`. This helper keeps run-log semantics
 * consistent for E2E health checks.
 */
export function inferRunLogToolIsError(
  eventIsError: unknown,
  resultText: string | undefined,
  details: Record<string, unknown> | null,
): boolean {
  if (eventIsError === true) return true;
  if (!details) {
    return typeof resultText === "string" && /^error[:\s]/i.test(resultText.trim());
  }

  const errorType = details.error_type;
  if (typeof errorType === "boolean") return errorType;
  if (typeof errorType === "string") {
    const normalized = errorType.trim().toLowerCase();
    if (normalized === "true" || normalized === "error") return true;
  }

  const errorValue = details.error;
  if (typeof errorValue === "string") return errorValue.trim().length > 0;
  if (errorValue === true) return true;
  if (errorValue && typeof errorValue === "object") return true;

  return typeof resultText === "string" && /^error[:\s]/i.test(resultText.trim());
}

// ── Run-log result extraction helpers ──────────────────────────────────────
// Lightweight extractors for tool_end metadata. These mirror the patterns in
// cli/output.ts but are kept separate to avoid CLI-specific dependencies.

function extractRunLogResultText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const msg = result as { content?: Array<{ type: string; text?: string }> };
  if (Array.isArray(msg.content)) {
    for (const c of msg.content) {
      if (c.type === "text" && c.text) return c.text;
    }
  }
  return undefined;
}

function extractRunLogResultDetails(result: unknown): Record<string, unknown> | null {
  const text = extractRunLogResultText(result);
  if (text) {
    try { return JSON.parse(text) as Record<string, unknown>; } catch { /* non-JSON result */ }
  }
  const withDetails = result as { details?: unknown };
  if (withDetails?.details && typeof withDetails.details === "object") {
    return withDetails.details as Record<string, unknown>;
  }
  return null;
}

function formatRunLogToolSummary(tool: string, details: Record<string, unknown> | null): string | undefined {
  if (!details) return undefined;
  if (details.error) return `error: ${details.code || details.message || details.error}`;
  switch (tool) {
    case "web_search": return `${details.count ?? 0} results`;
    case "web_fetch": {
      const parts: string[] = [];
      if (typeof details.length === "number") parts.push(`${(details.length as number / 1024).toFixed(1)}KB`);
      if (details.cached) parts.push("cached");
      return parts.join(", ") || undefined;
    }
    case "data": return `${details.domain}/${details.action}`;
    case "glob": return `${details.count ?? 0} files`;
    case "exec": return details.exitCode !== undefined ? `exit ${details.exitCode}` : undefined;
    default: return undefined;
  }
}

export class Agent {
  private readonly agent: PiAgentCore;
  private output;
  private readonly session: SessionManager;
  private readonly profile?: ProfileManager;
  private readonly skillManager?: SkillManager;
  private readonly contextWindowGuard: ContextWindowGuardResult;
  private readonly debug: boolean;
  private reasoningMode: ReasoningMode;
  private toolsOptions: ResolveToolsOptions;
  private readonly originalToolsConfig?: ToolsConfig;
  private readonly stderr: NodeJS.WritableStream;
  private readonly runLog: RunLog;
  private readonly toolStartTimes = new Map<string, number>();
  private initialized = false;
  private allowSkillInstallForCurrentRun = false;
  private awaitingSkillInstallConfirmation = false;
  private allowWorkaroundForCurrentRun = false;
  private awaitingWorkaroundConfirmation = false;
  private allowCustomSkillAuthoringForCurrentRun = false;
  private awaitingCustomSkillAuthoringConfirmation = false;
  private readonly guardedExecApproval: ExecApprovalCallback;

  // Context window settings (for pre-flight compaction)
  private readonly reserveTokens: number;

  // Internal run state
  private _internalRun = false;
  private _isRunning = false;
  private _aborted = false;
  /** Last assistant message saved by the message_end event handler */
  private _lastEventSavedAssistant: AgentMessage | undefined;
  private _runMutex: Promise<void> = Promise.resolve();
  private _compactionPromise: Promise<void> = Promise.resolve();
  private currentUserDisplayPrompt: string | undefined;
  private currentUserSource: import("./session/types.js").MessageSource | undefined;

  // MulticaEvent subscribers (parallel to PiAgentCore's subscriber list)
  // Typed as AgentEvent | MulticaEvent to match subscribeAll() callback signature
  private multicaListeners: Array<(event: AgentEvent | MulticaEvent) => void> = [];

  // Auth profile rotation state
  private resolvedProvider: string;
  private currentApiKey: string | undefined;
  private currentProfileId: string | undefined;
  private profileCandidates: string[];
  private profileIndex: number;
  private readonly pinnedProfile: boolean;
  private readonly explicitApiKey: boolean;

  /** Resolved workspace directory */
  readonly workspaceDir: string;

  /** Current session ID */
  readonly sessionId: string;

  constructor(options: AgentOptions = {}) {
    const stdout = options.logger?.stdout ?? process.stdout;
    this.stderr = options.logger?.stderr ?? process.stderr;
    this.debug = options.debug ?? false;
    this.reasoningMode = options.reasoningMode ?? "stream";
    this.output = createAgentOutput({ stdout, stderr: this.stderr, reasoningMode: this.reasoningMode });

    // Load session metadata early so stored provider/model can inform defaults
    this.sessionId = options.sessionId ?? uuidv7();
    this.guardedExecApproval = this.createGuardedExecApprovalCallback(options.onExecApprovalNeeded);
    const storageAgentId = options.ownerAgentId;
    this.runLog = createRunLog(
      options.enableRunLog ?? !!process.env.MULTICA_RUN_LOG,
      this.sessionId,
      storageAgentId ? { agentId: storageAgentId } : undefined,
    );
    const storedMeta = (() => {
      const tempSession = new SessionManager({
        sessionId: this.sessionId,
        ...(storageAgentId ? { agentId: storageAgentId } : {}),
      });
      return tempSession.getMeta();
    })();

    // Resolve provider and model from options > session meta > env vars > defaults
    const defaultProvider = options.provider ?? storedMeta?.provider ?? credentialManager.getLlmProvider() ?? "kimi-coding";
    if (options.authProfileId) {
      const profileProvider = options.authProfileId.includes(":")
        ? options.authProfileId.split(":")[0]!
        : options.authProfileId;
      if (options.provider && options.provider !== profileProvider) {
        throw new Error(
          `authProfileId provider mismatch: authProfileId="${options.authProfileId}" ` +
          `does not match provider="${options.provider}"`,
        );
      }
      this.resolvedProvider = profileProvider;
    } else {
      this.resolvedProvider = defaultProvider;
    }
    const resolvedModel = resolveModelId(this.resolvedProvider, options.model);

    // === Auth profile resolution ===
    this.pinnedProfile = !!(options.authProfileId || options.apiKey);
    this.explicitApiKey = !!options.apiKey;

    if (options.apiKey) {
      // Explicit API key — no rotation
      this.currentApiKey = options.apiKey;
      this.currentProfileId = this.resolvedProvider;
      this.profileCandidates = [];
      this.profileIndex = 0;
    } else if (options.authProfileId) {
      // Pinned profile — no rotation
      this.currentApiKey = resolveApiKeyForProfile(options.authProfileId)
        ?? resolveApiKey(this.resolvedProvider);
      this.currentProfileId = options.authProfileId;
      this.profileCandidates = [];
      this.profileIndex = 0;
    } else {
      // Profile-aware resolution with rotation support
      const resolved = resolveApiKeyForProvider(this.resolvedProvider);
      if (resolved) {
        this.currentApiKey = resolved.apiKey;
        this.currentProfileId = resolved.profileId;
      } else {
        this.currentApiKey = undefined;
        this.currentProfileId = undefined;
      }

      // Load full candidate list for rotation
      const store = loadAuthProfileStore();
      this.profileCandidates = resolveAuthProfileOrder(this.resolvedProvider, store);
      this.profileIndex = this.currentProfileId
        ? Math.max(0, this.profileCandidates.indexOf(this.currentProfileId))
        : 0;
    }

    this.agent = new PiAgentCore({
      getApiKey: (_provider: string) => {
        if (!this.currentApiKey) {
          throw new Error(`No API key configured for provider: ${this.resolvedProvider}`);
        }
        return this.currentApiKey;
      },
      transformContext: async (messages) => {
        let result = sanitizeToolCallInputs(messages);
        result = sanitizeToolUseResultPairing(result);
        result = this.preflightCompact(result);
        // Re-validate after compaction — compaction can break tool_use/tool_result
        // pairing by dropping assistant messages while keeping their tool_results
        result = sanitizeToolUseResultPairing(result);
        return result;
      },
    });

    // Load Agent Profile (if profileId is specified)
    // Every Agent should have a Profile for tools config and other settings
    if (options.profileId) {
      this.profile = new ProfileManager({
        profileId: options.profileId,
        baseDir: options.profileBaseDir,
      });
      // Ensure profile directory exists (creates with default templates if new)
      this.profile.getOrCreateProfile(true);
    }

    // Initialize SkillManager (enabled by default)
    if (options.enableSkills !== false) {
      this.skillManager = new SkillManager({
        profileId: options.profileId,
        profileBaseDir: options.profileBaseDir,
        config: options.skills,
      });
    }

    const effectiveProvider = this.resolvedProvider;
    const effectiveModel = resolvedModel ?? options.model ?? storedMeta?.model;
    let model = resolveModel({ ...options, provider: effectiveProvider, model: effectiveModel });

    if (!model) {
      throw new Error(
        `Unknown model: provider="${effectiveProvider}", model="${effectiveModel}". ` +
        `Check ${getCredentialsPath()} for llm.provider and llm.providers.${effectiveProvider}.model.`,
      );
    }

    // Override base URL if provided via options or environment variable
    const baseUrl = resolveBaseUrl(model.provider, options.baseUrl);
    if (baseUrl) {
      model = { ...model, baseUrl };
    }

    // === Context Window Guard ===
    this.contextWindowGuard = checkContextWindow({
      modelContextWindow: model.contextWindow,
      configContextTokens: options.contextWindowTokens,
      defaultTokens: DEFAULT_CONTEXT_TOKENS,
    });

    // 警告：context window 较小
    if (this.contextWindowGuard.shouldWarn) {
      this.stderr.write(
        `[Context Window Guard] WARNING: Low context window: ${this.contextWindowGuard.tokens} tokens (source: ${this.contextWindowGuard.source})\n`,
      );
    }

    // 阻止：context window 太小
    if (this.contextWindowGuard.shouldBlock) {
      throw new Error(
        `[Context Window Guard] Context window too small: ${this.contextWindowGuard.tokens} tokens. ` +
          `Minimum required: 16,000 tokens. Please use a model with a larger context window.`,
      );
    }

    // Determine compaction mode (default: summary with LLM-based summarization)
    const compactionMode = options.compactionMode ?? "summary";

    // Resolve API key for summary mode (reuse the agent's own key)
    const summaryApiKey = compactionMode === "summary"
      ? (resolveApiKey(this.resolvedProvider, options.apiKey) ?? this.currentApiKey)
      : undefined;

    // Store reserveTokens for pre-flight compaction
    this.reserveTokens = options.reserveTokens ?? 1024;

    // 创建 SessionManager（带 context window 配置）
    this.session = new SessionManager({
      sessionId: this.sessionId,
      ...(storageAgentId ? { agentId: storageAgentId } : {}),
      compactionMode,
      // Token 模式参数
      contextWindowTokens: this.contextWindowGuard.tokens,
      // systemPrompt is set later via setSystemPrompt() after tools are resolved
      reserveTokens: options.reserveTokens,
      targetRatio: options.compactionTargetRatio,
      minKeepMessages: options.minKeepMessages,
      // Summary mode parameters
      model: compactionMode === "summary" ? model : undefined,
      apiKey: summaryApiKey,
      customInstructions: options.summaryInstructions,
      // Observability
      runLog: this.runLog,
    });

    if (!options.thinkingLevel && storedMeta?.thinkingLevel) {
      this.agent.setThinkingLevel(storedMeta.thinkingLevel as any);
    } else if (options.thinkingLevel) {
      this.agent.setThinkingLevel(options.thinkingLevel);
    }

    // Resolve reasoningMode: options > profile config > storedMeta > default "stream"
    if (!options.reasoningMode) {
      const profileReasoningMode = this.profile?.getProfile()?.config?.reasoningMode;
      const metaReasoningMode = storedMeta?.reasoningMode as ReasoningMode | undefined;
      const resolved = profileReasoningMode ?? metaReasoningMode ?? "stream";
      if (resolved !== this.reasoningMode) {
        this.reasoningMode = resolved;
        // Re-create output with correct reasoningMode
        this.output = createAgentOutput({ stdout, stderr: this.stderr, reasoningMode: this.reasoningMode });
      }
    }

    this.agent.setModel(model);

    // Save original tools config from options (for later merging during reload)
    if (options.tools) {
      this.originalToolsConfig = options.tools;
    }

    // Resolve workspace directory
    const profileConfig = this.profile?.getProfile()?.config;
    this.workspaceDir = resolveWorkspaceDir({
      profileId: options.profileId,
      configWorkspaceDir: profileConfig?.workspaceDir,
    });
    ensureWorkspaceDir(this.workspaceDir);
    const effectiveCwd = options.cwd ?? this.workspaceDir;

    // Merge Profile tools config with options.tools (options takes precedence)
    const profileToolsConfig = this.profile?.getToolsConfig();
    const mergedToolsConfig = mergeToolsConfig(profileToolsConfig, options.tools);
    // Use this.sessionId (which may be auto-generated) instead of options.sessionId
    // (which may be undefined). Without this, delegate tool has no session context.
    this.toolsOptions = mergedToolsConfig
      ? {
        ...options,
        sessionId: this.sessionId,
        cwd: effectiveCwd,
        tools: mergedToolsConfig,
        provider: this.resolvedProvider,
        runLog: this.runLog,
        onExecApprovalNeeded: this.guardedExecApproval,
      }
      : {
        ...options,
        sessionId: this.sessionId,
        cwd: effectiveCwd,
        provider: this.resolvedProvider,
        runLog: this.runLog,
        onExecApprovalNeeded: this.guardedExecApproval,
      };

    const tools = resolveTools(this.toolsOptions);
    if (this.debug) {
      if (profileToolsConfig) {
        console.error(`[debug] Profile tools config: ${JSON.stringify(profileToolsConfig)}`);
      }
      console.error(`[debug] Merged tools config: ${JSON.stringify(mergedToolsConfig)}`);
      console.error(`[debug] Resolved ${tools.length} tools: ${tools.map(t => t.name).join(", ") || "(none)"}`);
    }
    this.agent.setTools(tools);

    // Build the system prompt using the structured builder
    const toolNames = tools.map((t: { name: string }) => t.name);
    const systemPrompt = this.buildFullSystemPrompt(options, toolNames);
    if (systemPrompt) {
      this.agent.setSystemPrompt(systemPrompt);
      this.session.setSystemPrompt(systemPrompt);
    }

    this.session.saveMeta({
      provider: this.resolvedProvider,
      model: this.agent.state.model?.id,
      thinkingLevel: this.agent.state.thinkingLevel,
      reasoningMode: this.reasoningMode,
      contextWindowTokens: this.contextWindowGuard.tokens,
    });

    this.agent.subscribe((event: AgentEvent) => {
      this.output.handleEvent(event);
      this.handleSessionEvent(event);
      this.handleRunLogEvent(event);
    });

    if (this.debug && this.currentProfileId) {
      console.error(`[debug] Auth profile: ${this.currentProfileId} (pinned=${this.pinnedProfile}, candidates=${this.profileCandidates.length})`);
    }
  }

  /** Subscribe to raw AgentEvent from the underlying engine */
  subscribe(fn: (event: AgentEvent) => void): () => void {
    return this.agent.subscribe(fn);
  }

  /** Subscribe to both AgentEvent and MulticaEvent streams */
  subscribeAll(fn: (event: AgentEvent | MulticaEvent) => void): () => void {
    const unsubCore = this.agent.subscribe(fn);
    this.multicaListeners.push(fn);
    return () => {
      unsubCore();
      const idx = this.multicaListeners.indexOf(fn);
      if (idx >= 0) this.multicaListeners.splice(idx, 1);
    };
  }

  emitMulticaEvent(event: MulticaEvent): void {
    for (const fn of this.multicaListeners) {
      try {
        fn(event);
      } catch {
        // Don't let listener errors break the agent loop
      }
    }
  }

  /** Emit an error event through the subscriber mechanism */
  emitError(message: string): void {
    this.emitMulticaEvent({ type: "agent_error", message });
  }

  async run(
    prompt: string,
    options?: { displayPrompt?: string; source?: import("./session/types.js").MessageSource },
  ): Promise<AgentRunResult> {
    // Run-level mutex: prevents concurrent run/runInternal from mis-tagging messages
    return this.withRunMutex(() => this._run(prompt, options));
  }

  /**
   * Run a prompt as an internal turn.
   * Messages are persisted with `internal: true` and rolled back from
   * in-memory state after the turn completes, so they do not pollute
   * the main conversation context.
   */
  async runInternal(prompt: string): Promise<AgentRunResult> {
    return this.withRunMutex(async () => {
      const messageCountBefore = this.agent.state.messages.length;
      this._internalRun = true;
      try {
        const result = await this._run(prompt);
        return result;
      } finally {
        this._internalRun = false;
        // Roll back internal messages from in-memory state
        const current = this.agent.state.messages;
        if (current.length > messageCountBefore) {
          this.agent.replaceMessages(current.slice(0, messageCountBefore));
        }
      }
    });
  }

  private async withRunMutex<T>(fn: () => Promise<T>): Promise<T> {
    // Chain on the mutex so only one run executes at a time
    const prev = this._runMutex;
    let resolve: () => void;
    this._runMutex = new Promise<void>((r) => { resolve = r; });
    await prev;
    try {
      return await fn();
    } finally {
      resolve!();
    }
  }

  private async _run(
    prompt: string,
    options?: { displayPrompt?: string; source?: import("./session/types.js").MessageSource },
  ): Promise<AgentRunResult> {
    // Wait for any in-flight compaction from the previous run
    await this._compactionPromise;
    await this.ensureInitialized();
    this.refreshAuthState();
    this.output.state.lastAssistantText = "";
    this.currentUserDisplayPrompt = options?.displayPrompt;
    this.currentUserSource = options?.source;
    this._isRunning = true;
    this._aborted = false;

    if (this._internalRun) {
      this.allowSkillInstallForCurrentRun = false;
      this.allowWorkaroundForCurrentRun = false;
      this.allowCustomSkillAuthoringForCurrentRun = false;
    } else {
      const consent = evaluateSkillInstallConsent(prompt, this.awaitingSkillInstallConfirmation);
      if (consent.declined) {
        this.awaitingSkillInstallConfirmation = false;
      }
      this.allowSkillInstallForCurrentRun = consent.allowInstall;
      if (consent.allowInstall) {
        this.awaitingSkillInstallConfirmation = false;
      }

      const workaroundConsent = evaluateWorkaroundConsent(prompt, this.awaitingWorkaroundConfirmation);
      if (workaroundConsent.declined) {
        this.awaitingWorkaroundConfirmation = false;
      }
      this.allowWorkaroundForCurrentRun = workaroundConsent.allowWorkaround;
      if (workaroundConsent.allowWorkaround) {
        this.awaitingWorkaroundConfirmation = false;
      }

      const customSkillConsent = evaluateCustomSkillAuthoringConsent(
        prompt,
        this.awaitingCustomSkillAuthoringConfirmation,
      );
      if (customSkillConsent.declined) {
        this.awaitingCustomSkillAuthoringConfirmation = false;
      }
      this.allowCustomSkillAuthoringForCurrentRun = customSkillConsent.allowAuthoring;
      if (customSkillConsent.allowAuthoring) {
        this.awaitingCustomSkillAuthoringConfirmation = false;
      }
    }

    const runStart = Date.now();
    this.runLog.log("run_start", {
      prompt: prompt.slice(0, 200),
      internal: this._internalRun,
      provider: this.resolvedProvider,
      model: this.agent.state.model?.id,
      messages: this.agent.state.messages.length,
    });

    try {
      // Early validation: check API key before calling PiAgentCore.prompt(),
      // because getApiKey errors thrown inside PiAgentCore's internal async
      // context result in UnhandledPromiseRejection instead of propagating.
      if (!this.currentApiKey) {
        const errorMsg = `No API key configured for provider: ${this.resolvedProvider}. Please configure a provider in Agent Settings.`;
        this.runLog.log("run_end", { duration_ms: Date.now() - runStart, error: errorMsg });
        return { text: "", error: errorMsg };
      }

      const canRotate = !this.pinnedProfile && this.profileCandidates.length > 1;
      let lastError: unknown;

      const MAX_OVERFLOW_COMPACTION_ATTEMPTS = 2;
      let overflowAttempts = 0;
      const MAX_FORMAT_REPAIR_ATTEMPTS = 1;
      let formatRepairAttempts = 0;

      // Loop to exhaust all candidate profiles on rotatable errors
      while (true) {
        try {
          const llmStart = Date.now();
          this.runLog.log("llm_call", {
            provider: this.resolvedProvider,
            model: this.agent.state.model?.id,
            profile: this.currentProfileId,
            messages: this.agent.state.messages.length,
          });
          await this.agent.prompt(prompt);
          this.runLog.log("llm_result", {
            duration_ms: Date.now() - llmStart,
          });
          break; // success — exit loop
        } catch (error) {
          lastError = error;
          const errorMsg = error instanceof Error ? error.message : String(error);

          // Context overflow recovery: auto-compact and retry before trying auth rotation
          if (isContextOverflowError(error) && overflowAttempts < MAX_OVERFLOW_COMPACTION_ATTEMPTS) {
            overflowAttempts++;
            this.stderr.write(
              `[context-overflow] Overflow detected (attempt ${overflowAttempts}/${MAX_OVERFLOW_COMPACTION_ATTEMPTS}), compacting...\n`,
            );
            const messages = this.agent.state.messages.slice();
            this.runLog.log("context_overflow", {
              attempt: overflowAttempts,
              messages_before: messages.length,
            });
            const result = await this.session.maybeCompact(messages);
            if (result?.kept) {
              this.runLog.log("context_overflow_compacted", {
                messages_after: result.kept.length,
                tokens_removed: result.tokensRemoved,
              });
              this.agent.replaceMessages(result.kept);
              this.output.state.lastAssistantText = "";
              continue; // retry with compacted messages
            }
            // Forced fallback: estimation may diverge from reality (the LLM
            // already told us the context is too large), so drop the oldest
            // half of messages even when maybeCompact thinks no compaction is needed.
            if (messages.length > MIN_KEEP_MESSAGES) {
              const keepCount = Math.max(MIN_KEEP_MESSAGES, Math.floor(messages.length / 2));
              const forcedKept = messages.slice(-keepCount);
              this.stderr.write(
                `[context-overflow] Forced compaction: ${messages.length} → ${forcedKept.length} messages\n`,
              );
              this.runLog.log("context_overflow_forced", {
                messages_before: messages.length,
                messages_after: forcedKept.length,
              });
              this.agent.replaceMessages(forcedKept);
              this.output.state.lastAssistantText = "";
              continue;
            }
          }

          const reason = classifyError(error);
          this.runLog.log("error_classify", {
            error: errorMsg.slice(0, 200),
            reason,
            rotatable: isRotatableError(reason),
          });

          // Format error recovery: reload sanitized messages from disk and retry.
          // This handles corrupted in-memory state (e.g. orphaned tool_call_id references)
          // that causes persistent 400 errors until process restart.
          if (reason === "format" && formatRepairAttempts < MAX_FORMAT_REPAIR_ATTEMPTS) {
            formatRepairAttempts++;
            this.stderr.write(
              `[format-repair] Format error detected (attempt ${formatRepairAttempts}/${MAX_FORMAT_REPAIR_ATTEMPTS}), reloading messages from disk...\n`,
            );
            this.runLog.log("format_repair", {
              attempt: formatRepairAttempts,
              error: errorMsg.slice(0, 200),
              messages_before: this.agent.state.messages.length,
            });
            const repairedMessages = this.session.loadMessages();
            if (repairedMessages.length > 0) {
              this.runLog.log("format_repair_reloaded", {
                messages_after: repairedMessages.length,
              });
              this.agent.replaceMessages(repairedMessages);
              this.output.state.lastAssistantText = "";
              continue; // retry with sanitized messages
            }
          }

          if (this.currentProfileId && isRotatableError(reason)) {
            markAuthProfileFailure(this.currentProfileId, reason);
          }

          if (!canRotate || !this.currentProfileId) throw error;
          if (!isRotatableError(reason)) throw error;

          if (this.debug) {
            this.stderr.write(
              `[auth-profile] Profile "${this.currentProfileId}" failed (${reason}), attempting rotation...\n`,
            );
          }

          const fromProfile = this.currentProfileId;
          if (!this.advanceAuthProfile()) {
            throw lastError; // All profiles exhausted
          }

          this.runLog.log("auth_rotate", {
            from: fromProfile,
            to: this.currentProfileId,
            reason,
          });

          if (this.debug) {
            this.stderr.write(
              `[auth-profile] Rotated to profile "${this.currentProfileId}"\n`,
            );
          }

          // Reset output for retry
          this.output.state.lastAssistantText = "";
          // continue loop with new profile
        }
      }

      // Mark success
      if (this.currentProfileId) {
        markAuthProfileUsed(this.currentProfileId);
        markAuthProfileGood(this.resolvedProvider, this.currentProfileId);
      }

      const thinking = this.reasoningMode !== "off"
        ? this.output.state.lastAssistantThinking || undefined
        : undefined;

      // On abort: clear the error so it doesn't propagate as an agent error,
      // and return partial text without an error flag.
      if (this._aborted) {
        this.agent.state.error = undefined;
        this.runLog.log("run_end", { duration_ms: Date.now() - runStart, aborted: true });
        return { text: this.output.state.lastAssistantText, thinking, error: undefined };
      }

      const error = this.agent.state.error;
      this.runLog.log("run_end", {
        duration_ms: Date.now() - runStart,
        error: error ?? null,
        text: this.output.state.lastAssistantText.slice(0, 200),
      });
      return { text: this.output.state.lastAssistantText, thinking, error };
    } finally {
      // On abort, persist any partial messages that pi-agent-core appended
      // via appendMessage() (no message_end event fires for those).
      // Skip if message_end already fired for this message (avoids duplicates).
      if (this._aborted) {
        const messages = this.agent.state.messages;
        const lastMsg = messages[messages.length - 1];
        if (lastMsg?.role === "assistant" && lastMsg !== this._lastEventSavedAssistant) {
          this.session.saveMessage(lastMsg);
        }
      }
      this._isRunning = false;
      this._aborted = false;
      this.allowSkillInstallForCurrentRun = false;
      this.allowWorkaroundForCurrentRun = false;
      this.allowCustomSkillAuthoringForCurrentRun = false;
      this._lastEventSavedAssistant = undefined;
      this.currentUserDisplayPrompt = undefined;
      this.currentUserSource = undefined;
      this.runLog.flush().catch(() => {});
    }
  }

  private createGuardedExecApprovalCallback(
    base?: ExecApprovalCallback,
  ): ExecApprovalCallback {
    return async (command, cwd) => {
      const needsInstallConsent =
        isMutatingClawhubCommand(command) || isEnvironmentInstallCommand(command);
      const needsWorkaroundConsent = isThirdPartyWorkaroundCommand(command);
      const needsCustomSkillAuthoringConsent = isLocalSkillMutationCommand(command);
      if (needsInstallConsent && !this.allowSkillInstallForCurrentRun) {
        this.awaitingSkillInstallConfirmation = true;
        this.runLog.log("install_guard", {
          action: "blocked",
          reason: "explicit_user_confirmation_required",
          command: command.slice(0, 200),
        });
        return {
          approved: false,
          decision: "deny",
          message:
            "Install command blocked: explicit user confirmation is required first. Ask the user whether to continue installation.",
        };
      }

      if (needsInstallConsent) {
        this.runLog.log("install_guard", {
          action: "allowed",
          reason: "user_confirmed",
          command: command.slice(0, 200),
        });
      }

      if (needsCustomSkillAuthoringConsent && !this.allowCustomSkillAuthoringForCurrentRun) {
        this.awaitingCustomSkillAuthoringConfirmation = true;
        this.runLog.log("custom_skill_guard", {
          action: "blocked",
          reason: "explicit_custom_skill_authoring_confirmation_required",
          command: command.slice(0, 200),
        });
        return {
          approved: false,
          decision: "deny",
          message:
            "Manual local skill creation command blocked by policy. Use ClawHub discovery/install flow first, or ask the user to explicitly confirm custom skill authoring.",
        };
      }

      if (needsCustomSkillAuthoringConsent) {
        this.runLog.log("custom_skill_guard", {
          action: "allowed",
          reason: "user_confirmed_custom_skill_authoring",
          command: command.slice(0, 200),
        });
      }

      if (needsWorkaroundConsent && !this.allowWorkaroundForCurrentRun) {
        this.awaitingWorkaroundConfirmation = true;
        this.runLog.log("workaround_guard", {
          action: "blocked",
          reason: "explicit_workaround_opt_in_required",
          command: command.slice(0, 200),
        });
        return {
          approved: false,
          decision: "deny",
          message:
            "Local workaround command blocked by policy. First explain the capability gap and ask whether to search/install a Cloud Hub skill, or get explicit user opt-in for workaround mode.",
        };
      }

      if (needsWorkaroundConsent) {
        this.runLog.log("workaround_guard", {
          action: "allowed",
          reason: "user_opted_in_workaround_mode",
          command: command.slice(0, 200),
        });
      }

      if (base) {
        return base(command, cwd);
      }

      return { approved: true, decision: "allow-once" };
    };
  }

  /**
   * Advance to the next non-cooldown auth profile.
   * Returns true if a new profile was activated, false if exhausted.
   */
  private advanceAuthProfile(): boolean {
    const store = loadAuthProfileStore();
    const startIndex = this.profileIndex;

    for (let i = 1; i < this.profileCandidates.length; i++) {
      const nextIndex = (startIndex + i) % this.profileCandidates.length;
      const candidateId = this.profileCandidates[nextIndex] as string | undefined;
      if (!candidateId) continue;

      // Skip profiles in cooldown
      const stats = store.usageStats?.[candidateId];
      if (stats && isProfileInCooldown(stats)) continue;

      // Try to resolve API key
      const apiKey = resolveApiKeyForProfile(candidateId);
      if (!apiKey) continue;

      this.currentApiKey = apiKey;
      this.currentProfileId = candidateId;
      this.profileIndex = nextIndex;
      this.updateSessionApiKey();
      return true;
    }

    return false;
  }

  private refreshAuthState(): void {
    if (this.explicitApiKey) {
      return;
    }

    const store = loadAuthProfileStore();

    if (this.pinnedProfile) {
      const profileId = this.currentProfileId ?? this.resolvedProvider;
      this.currentApiKey = resolveApiKeyForProfile(profileId) ?? resolveApiKey(this.resolvedProvider);
      this.currentProfileId = profileId;
      this.profileCandidates = [];
      this.profileIndex = 0;
      this.updateSessionApiKey();
      return;
    }

    const candidates = resolveAuthProfileOrder(this.resolvedProvider, store);
    this.profileCandidates = candidates;

    if (this.currentProfileId) {
      const currentIndex = candidates.indexOf(this.currentProfileId);
      if (currentIndex >= 0) {
        const stats = store.usageStats?.[this.currentProfileId];
        if (!stats || !isProfileInCooldown(stats)) {
          const apiKey = resolveApiKeyForProfile(this.currentProfileId);
          if (apiKey) {
            this.currentApiKey = apiKey;
            this.profileIndex = currentIndex;
            this.updateSessionApiKey();
            return;
          }
        }
      }
    }

    const resolved = resolveApiKeyForProvider(this.resolvedProvider);
    if (resolved) {
      this.currentApiKey = resolved.apiKey;
      this.currentProfileId = resolved.profileId;
      this.profileIndex = Math.max(0, candidates.indexOf(resolved.profileId));
    } else {
      this.currentApiKey = undefined;
      this.currentProfileId = undefined;
      this.profileIndex = 0;
    }
    this.updateSessionApiKey();
  }

  private updateSessionApiKey(): void {
    if (this.session.getCompactionMode() !== "summary") return;
    this.session.setApiKey(this.currentApiKey);
  }

  private handleRunLogEvent(event: AgentEvent) {
    if (event.type === "tool_execution_start") {
      const toolName = (event as any).toolName ?? "unknown";
      this.toolStartTimes.set(toolName, Date.now());
      this.runLog.log("tool_start", {
        tool: toolName,
        args: JSON.stringify((event as any).args ?? {}).slice(0, 500),
      });
    } else if (event.type === "tool_execution_end") {
      const toolName = (event as any).toolName ?? "unknown";
      const startTime = this.toolStartTimes.get(toolName);
      const duration_ms = startTime ? Date.now() - startTime : undefined;
      this.toolStartTimes.delete(toolName);

      // Extract result metadata for run-log persistence (survives session compaction)
      const result = (event as any).result;
      const resultText = extractRunLogResultText(result);
      const resultChars = resultText?.length ?? 0;
      const details = extractRunLogResultDetails(result);
      const isError = inferRunLogToolIsError((event as any).isError, resultText, details);

      const toolEndData: Record<string, unknown> = {
        tool: toolName,
        duration_ms,
        is_error: isError,
        result_chars: resultChars,
        result_summary: formatRunLogToolSummary(toolName, details),
      };
      if (details?.error) {
        toolEndData.error_type = details.code ? String(details.code) : String(details.error);
      }
      this.runLog.log("tool_end", toolEndData);
    }
  }

  private handleSessionEvent(event: AgentEvent) {
    if (event.type === "message_end") {
      const message = event.message as AgentMessage;
      const saveOptions: { internal?: boolean; displayContent?: UserMessage["content"]; source?: import("./session/types.js").MessageSource } = {};
      if (this._internalRun) {
        saveOptions.internal = true;
      }
      if (message.role === "user" && this.currentUserDisplayPrompt !== undefined) {
        saveOptions.displayContent = this.currentUserDisplayPrompt;
      }
      if (message.role === "user" && this.currentUserSource !== undefined) {
        saveOptions.source = this.currentUserSource;
      }
      this.session.saveMessage(message, Object.keys(saveOptions).length > 0 ? saveOptions : undefined);
      if (message.role === "assistant") {
        this._lastEventSavedAssistant = message;
      }
      // Skip compaction during internal runs — internal messages will be
      // rolled back from memory afterwards, so compacting now would be incorrect.
      if (message.role === "assistant" && !this._internalRun) {
        this._compactionPromise = this.maybeCompact().catch((err) => {
          console.error("[Agent] Compaction failed:", err);
        });
      }
    }
  }

  /**
   * Pre-flight context compaction — runs inside transformContext before every LLM call.
   * Pure in-memory, no disk writes. Prunes tool results and drops oldest messages
   * when the estimated token utilization exceeds the compaction trigger threshold.
   */
  private preflightCompact(messages: AgentMessage[]): AgentMessage[] {
    const estimation = estimateTokenUsage({
      messages,
      systemPrompt: this.agent.state.systemPrompt,
      contextWindowTokens: this.contextWindowGuard.tokens,
      reserveTokens: this.reserveTokens,
    });

    if (estimation.utilizationRatio < COMPACTION_TRIGGER_RATIO) {
      return messages; // fast path
    }

    this.runLog.log("preflight_compact_start", {
      utilization: estimation.utilizationRatio,
      trigger: COMPACTION_TRIGGER_RATIO,
      messages: messages.length,
      est_tokens: estimation.messageTokens,
    });

    const originalCount = messages.length;
    let result = messages;

    // Drop oldest messages if over threshold (emergency safety net).
    // Tool result pruning is skipped here — it's handled by post-turn
    // compaction which actually persists the results.
    const compacted = compactMessagesTokenAware(result, estimation.availableTokens);
    if (compacted) {
      result = compacted.kept;
    }

    if (result.length < originalCount) {
      const saved = originalCount - result.length;
      this.stderr.write(
        `[pre-flight compaction] pruned ${saved} messages (${originalCount} → ${result.length})\n`,
      );
      this.runLog.log("preflight_compact_end", {
        messages_before: originalCount,
        messages_after: result.length,
        pruned: saved,
      });
    }

    return result;
  }

  private async maybeCompact() {
    const messages = this.agent.state.messages.slice();
    if (!this.session.needsCompaction(messages)) return;

    const result = await this.session.maybeCompact(messages);
    if (!result) return;

    this.emitMulticaEvent({ type: "compaction_start" });
    if (result.kept) {
      this.agent.replaceMessages(result.kept);
    }
    const endEvent: CompactionEndEvent = {
      type: "compaction_end",
      removed: result.removedCount ?? 0,
      kept: result.kept.length ?? messages.length,
      tokensRemoved: result.tokensRemoved,
      tokensKept: result.tokensKept,
      reason: result.reason ?? "tokens",
      summary: result.summary,
      pruningStats: result.pruningStats,
    };
    this.emitMulticaEvent(endEvent);
    this.runLog.log("compaction", {
      removed: endEvent.removed,
      kept: endEvent.kept,
      tokens_removed: endEvent.tokensRemoved,
      tokens_kept: endEvent.tokensKept,
      reason: endEvent.reason,
      pruning_stats: endEvent.pruningStats,
    });
  }

  /**
   * Wait for all pending session storage writes to complete.
   */
  async flushSession(): Promise<void> {
    await this.session.flush();
  }

  /**
   * Reload tools from profile config.
   * Call this after updating tool status to apply changes
   * without restarting the agent session.
   */
  reloadTools(): string[] {
    // Re-read profile tools config to get latest changes
    const profileToolsConfig = this.profile?.getToolsConfig();
    console.log(`[Agent] reloadTools: profileToolsConfig =`, JSON.stringify(profileToolsConfig));
    const mergedToolsConfig = mergeToolsConfig(profileToolsConfig, this.originalToolsConfig);
    console.log(`[Agent] reloadTools: mergedToolsConfig =`, JSON.stringify(mergedToolsConfig));
    this.toolsOptions = mergedToolsConfig
      ? { ...this.toolsOptions, tools: mergedToolsConfig }
      : this.toolsOptions;

    const tools = resolveTools(this.toolsOptions);
    console.log(`[Agent] reloadTools: resolved ${tools.length} tools: ${tools.map(t => t.name).join(", ") || "(none)"}`);
    this.agent.setTools(tools);
    if (this.debug) {
      console.error(`[debug] Reloaded ${tools.length} tools: ${tools.map(t => t.name).join(", ") || "(none)"}`);
    }
    return tools.map(t => t.name);
  }

  /** Get current active tool names */
  getActiveTools(): string[] {
    return this.agent.state.tools?.map(t => t.name) ?? [];
  }

  /** Whether the agent is currently executing an internal run */
  get isInternalRun(): boolean {
    return this._internalRun;
  }

  /** Whether a run (normal or internal) is currently executing inside _run(). */
  get isRunning(): boolean {
    return this._isRunning;
  }

  /** Whether the underlying PiAgentCore is currently streaming an LLM response. */
  get isStreaming(): boolean {
    return this.agent.state.isStreaming;
  }

  /**
   * Queue a steering message to interrupt the agent mid-run.
   * Delivered after current tool execution, skipping remaining tool calls.
   * Safe to call from any context (does not require the run mutex).
   */
  steer(content: string): void {
    const msg: UserMessage = { role: "user", content, timestamp: Date.now() };
    this.agent.steer(msg);
  }

  /**
   * Queue a follow-up message for after the current run finishes.
   * Delivered only when the agent has no more tool calls or steering messages.
   */
  followUp(content: string): void {
    const msg: UserMessage = { role: "user", content, timestamp: Date.now() };
    this.agent.followUp(msg);
  }

  /** Whether the underlying PiAgentCore has queued steer/followUp messages. */
  hasQueuedMessages(): boolean {
    return this.agent.hasQueuedMessages();
  }

  /**
   * Abort the currently running prompt.
   * Triggers PiAgentCore's internal AbortController. The running prompt()
   * will resolve (not throw), partial content stays in state.messages.
   * Safe to call when no run is active (no-op).
   */
  abort(): void {
    this._aborted = true;
    this.agent.abort();
  }

  /**
   * Persist a synthetic assistant message into both in-memory state and session JSONL.
   * Used after an internal run to keep the LLM summary visible in future turns
   * while the internal prompt stays hidden.
   */
  persistAssistantSummary(text: string): void {
    const model = this.agent.state.model;
    const message = {
      role: "assistant" as const,
      content: [{ type: "text" as const, text }],
      api: model?.api ?? "openai-completions",
      provider: model?.provider ?? "internal",
      model: model?.id ?? "unknown",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop" as const,
      timestamp: Date.now(),
    };

    this.agent.appendMessage(message);
    this.session.saveMessage(message);
  }

  /** Ensure session messages are loaded from disk (idempotent) */
  async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    await this.session.repairIfNeeded((msg) => console.error(msg));
    const restoredMessages = this.session.loadMessages();
    if (restoredMessages.length > 0) {
      this.agent.replaceMessages(restoredMessages);
    }
    this.initialized = true;
  }

  /** Get all messages from the current session (in-memory state) */
  getMessages(): AgentMessage[] {
    return this.agent.state.messages.slice();
  }

  /**
   * Load messages from session storage with filtering.
   * By default, internal messages are excluded.
   */
  loadSessionMessages(options?: { includeInternal?: boolean }): AgentMessage[] {
    return this.session.loadMessages(options);
  }

  /**
   * Load messages from session storage for UI rendering.
   * User messages prefer stored displayContent when present.
   */
  loadSessionMessagesForDisplay(options?: { includeInternal?: boolean }): AgentMessage[] {
    return this.session.loadMessagesForDisplay(options);
  }

  /**
   * Get all skills with their eligibility status.
   * Returns empty array if skills are disabled.
   */
  getSkillsWithStatus(): Array<{
    id: string;
    name: string;
    description: string;
    source: string;
    eligible: boolean;
    reasons?: string[] | undefined;
  }> {
    if (!this.skillManager) {
      return [];
    }
    return this.skillManager.listAllSkillsWithStatus();
  }

  /**
   * Get eligible skills only.
   * Returns empty array if skills are disabled.
   */
  getEligibleSkills(): Array<{
    id: string;
    name: string;
    description: string;
    source: string;
  }> {
    if (!this.skillManager) {
      return [];
    }
    return this.skillManager.listSkills();
  }

  /**
   * Reload skills from disk.
   * Call this after adding/removing skills to apply changes.
   */
  reloadSkills(): void {
    if (this.skillManager) {
      this.skillManager.reload();
    }
  }

  /**
   * Set a tool's enabled status and persist to profile config.
   * Returns the new tools config, or undefined if no profile is loaded.
   */
  setToolStatus(toolName: string, enabled: boolean): { allow?: string[]; deny?: string[] } | undefined {
    if (!this.profile) {
      return undefined;
    }
    const newConfig = this.profile.setToolEnabled(toolName, enabled);
    // Reload tools to apply changes
    this.reloadTools();
    // Build result object, only including defined properties
    const result: { allow?: string[]; deny?: string[] } = {};
    if (newConfig.allow) result.allow = newConfig.allow;
    if (newConfig.deny) result.deny = newConfig.deny;
    return result;
  }

  /**
   * Get current profile ID, if any.
   */
  getProfileId(): string | undefined {
    return this.profile?.getProfile()?.id;
  }

  /**
   * Get profile directory path, if profile is enabled.
   */
  getProfileDir(): string | undefined {
    return this.profile?.getProfileDir();
  }

  /**
   * Get heartbeat configuration from profile config.
   */
  getHeartbeatConfig():
    | {
        enabled?: boolean | undefined;
        every?: string | undefined;
        prompt?: string | undefined;
        ackMaxChars?: number | undefined;
      }
    | undefined {
    return this.profile?.getHeartbeatConfig();
  }

  /**
   * Get agent display name from profile config.
   */
  getAgentName(): string | undefined {
    return this.profile?.getName();
  }

  /**
   * Update agent display name in profile config.
   */
  setAgentName(name: string): void {
    this.profile?.updateName(name);
  }

  /**
   * Get user.md content from profile.
   */
  getUserContent(): string | undefined {
    return this.profile?.getUserContent();
  }

  /**
   * Update user.md content in profile.
   */
  setUserContent(content: string): void {
    this.profile?.updateUserContent(content);
  }

  /**
   * Get current provider and model information.
   */
  getProviderInfo(): { provider: string; model: string | undefined } {
    return {
      provider: this.resolvedProvider,
      model: this.agent.state.model?.id,
    };
  }

  /**
   * Get persisted session metadata.
   */
  getSessionMeta(): SessionMeta | undefined {
    return this.session.getMeta();
  }

  /**
   * Get effective context window token limit for this session.
   */
  getContextWindowTokens(): number {
    return this.session.getMeta()?.contextWindowTokens ?? this.session.getContextWindowTokens();
  }

  /**
   * Switch to a different provider and/or model.
   * This updates the agent's model without recreating the session.
   */
  setProvider(providerId: string, modelId?: string): { provider: string; model: string | undefined } {
    // Resolve the actual provider (handle aliases like claude-code -> anthropic)
    const actualProvider = PROVIDER_ALIAS[providerId] ?? providerId;

    // Resolve the model
    const targetModel = modelId ?? getDefaultModel(providerId) ?? getDefaultModel(actualProvider);
    const model = resolveModel({ provider: providerId, model: targetModel });

    if (!model) {
      throw new Error(`Failed to resolve model for provider: ${providerId}, model: ${targetModel}`);
    }

    // Resolve API key for the new provider
    // For OAuth providers (claude-code, openai-codex), we need to use the original providerId
    // because OAuth credentials are resolved by the original provider name, not the alias
    const resolved = resolveApiKeyForProvider(providerId);
    if (resolved) {
      this.currentApiKey = resolved.apiKey;
      this.currentProfileId = resolved.profileId;
    } else {
      // Fallback: try with actual provider (for API key based providers)
      this.currentApiKey = resolveApiKey(actualProvider);
      this.currentProfileId = actualProvider;
    }

    if (!this.currentApiKey) {
      throw new Error(`No API key configured for provider: ${providerId}`);
    }

    this.updateSessionApiKey();

    // Update the agent's model and API key
    const baseUrl = resolveBaseUrl(actualProvider);
    const modelWithBaseUrl = baseUrl ? { ...model, baseUrl } : model;
    this.agent.setModel(modelWithBaseUrl);

    // Update internal state
    this.resolvedProvider = providerId;
    // Keep toolsOptions.provider in sync so delegate tool inherits the current provider
    this.toolsOptions = { ...this.toolsOptions, provider: providerId };

    // Reload tools so delegate picks up the new provider in its closure.
    // Without this, the existing tool instance still captures the old provider.
    const tools = resolveTools(this.toolsOptions);
    this.agent.setTools(tools);

    // Update session metadata (save original providerId, not alias-resolved)
    this.session.saveMeta({
      provider: providerId,
      model: model.id,
      thinkingLevel: this.agent.state.thinkingLevel,
      reasoningMode: this.reasoningMode,
      contextWindowTokens: this.contextWindowGuard.tokens,
    });

    // Rebuild system prompt so runtime info reflects the new provider/model
    const toolNames = tools.map((t) => t.name);
    const systemPrompt = this.rebuildSystemPrompt(toolNames);
    if (systemPrompt) {
      this.agent.setSystemPrompt(systemPrompt);
      this.session.setSystemPrompt(systemPrompt);
    }

    return {
      provider: providerId,
      model: model.id,
    };
  }

  /**
   * Build the full system prompt using the structured builder.
   * Combines profile content, tools, skills, and runtime info.
   */
  private buildFullSystemPrompt(
    options: AgentOptions,
    toolNames: string[],
  ): string | undefined {
    const skillsPrompt = this.skillManager?.buildSkillsPrompt();

    // If a raw systemPrompt is provided directly, use it as-is (backward compat)
    if (!options.profileId && options.systemPrompt) {
      return skillsPrompt
        ? `${options.systemPrompt}\n\n${skillsPrompt}`
        : options.systemPrompt;
    }

    if (!this.profile?.getProfile() && !options.profileId) {
      return skillsPrompt || undefined;
    }

    return this.rebuildSystemPrompt(toolNames);
  }

  /**
   * Reload profile from disk and rebuild system prompt.
   * Call this after updating profile files to apply changes immediately.
   */
  reloadSystemPrompt(): void {
    if (!this.profile) {
      return;
    }

    this.profile.reloadProfile();

    const toolNames = (this.agent.state.tools ?? []).map((t: { name: string }) => t.name);
    const systemPrompt = this.rebuildSystemPrompt(toolNames);

    if (systemPrompt) {
      this.agent.setSystemPrompt(systemPrompt);
      this.session.setSystemPrompt(systemPrompt);
    }
  }

  /**
   * Rebuild system prompt from current state.
   * Shared by constructor (via buildFullSystemPrompt) and reloadSystemPrompt.
   */
  private rebuildSystemPrompt(toolNames: string[]): string | undefined {
    const profile = this.profile?.getProfile();
    if (!profile) return undefined;

    const skillsPrompt = this.skillManager?.buildSkillsPrompt();

    const runtime = collectRuntimeInfo({
      agentName: this.profile?.getName(),
      provider: this.resolvedProvider,
      model: this.agent.state.model?.id,
      cwd: this.toolsOptions.cwd,
    });

    return buildStructuredSystemPrompt({
      mode: "full",
      profile: {
        soul: profile.soul,
        user: profile.user,
        workspace: profile.workspace,
        heartbeat: profile.heartbeat,
        config: profile.config,
      },
      profileDir: this.profile!.getProfileDir(),
      workspaceDir: this.workspaceDir,
      tools: toolNames,
      skillsPrompt,
      runtime,
      channels: this.toolsOptions.channels,
    });
  }
}
