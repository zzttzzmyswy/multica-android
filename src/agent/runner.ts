import { Agent as PiAgentCore, type AgentEvent, type AgentMessage } from "@mariozechner/pi-agent-core";
import { v7 as uuidv7 } from "uuid";
import type { AgentOptions, AgentRunResult } from "./types.js";
import { createAgentOutput } from "./cli/output.js";
import { resolveModel, resolveTools } from "./tools.js";
import { SessionManager } from "./session/session-manager.js";
import { ProfileManager } from "./profile/index.js";
import { SkillManager } from "./skills/index.js";
import { credentialManager, getCredentialsPath } from "./credentials.js";
import {
  resolveApiKey,
  resolveBaseUrl,
  resolveModelId,
  isOAuthProvider,
  getLoginInstructions,
} from "./providers/index.js";
import {
  checkContextWindow,
  DEFAULT_CONTEXT_TOKENS,
  type ContextWindowGuardResult,
} from "./context-window/index.js";
import { mergeToolsConfig, type ToolsConfig } from "./tools/policy.js";

export class Agent {
  private readonly agent: PiAgentCore;
  private readonly output;
  private readonly session: SessionManager;
  private readonly profile?: ProfileManager;
  private readonly skillManager?: SkillManager;
  private readonly contextWindowGuard: ContextWindowGuardResult;
  private readonly debug: boolean;
  private toolsOptions: AgentOptions;
  private readonly originalToolsConfig?: ToolsConfig;

  /** Current session ID */
  readonly sessionId: string;

  constructor(options: AgentOptions = {}) {
    const stdout = options.logger?.stdout ?? process.stdout;
    const stderr = options.logger?.stderr ?? process.stderr;
    this.output = createAgentOutput({ stdout, stderr });
    this.debug = options.debug ?? false;

    // Resolve provider and model from options > env vars > defaults
    const resolvedProvider = options.provider ?? credentialManager.getLlmProvider() ?? "kimi-coding";
    const resolvedModel = resolveModelId(resolvedProvider, options.model);
    const apiKey = resolveApiKey(resolvedProvider, options.apiKey);

    // Validate credentials before proceeding
    if (!apiKey) {
      if (isOAuthProvider(resolvedProvider)) {
        // OAuth provider without valid credentials - show login instructions
        const instructions = getLoginInstructions(resolvedProvider);
        throw new Error(
          `Provider "${resolvedProvider}" requires authentication.\n\n` +
          `${instructions}\n\n` +
          `After logging in, run: multica --provider ${resolvedProvider}`,
        );
      }
      // API Key provider without key - show configuration instructions
      throw new Error(
        `Provider "${resolvedProvider}" requires an API key.\n\n` +
        `Add your API key to: ${getCredentialsPath()}\n\n` +
        `Example:\n` +
        `{\n` +
        `  "llm": {\n` +
        `    "provider": "${resolvedProvider}",\n` +
        `    "providers": {\n` +
        `      "${resolvedProvider}": {\n` +
        `        "apiKey": "your-api-key-here"\n` +
        `      }\n` +
        `    }\n` +
        `  }\n` +
        `}`,
      );
    }

    this.agent = new PiAgentCore(
      { getApiKey: (_provider: string) => apiKey },
    );

    // Load Agent Profile (if profileId is specified)
    // Every Agent should have a Profile for memory, tools config, and other settings
    let systemPrompt: string | undefined;
    if (options.profileId) {
      this.profile = new ProfileManager({
        profileId: options.profileId,
        baseDir: options.profileBaseDir,
      });
      // Ensure profile directory exists (creates with default templates if new)
      this.profile.getOrCreateProfile(true);
      systemPrompt = this.profile.buildSystemPrompt();
    } else if (options.systemPrompt) {
      // Use provided systemPrompt directly (no profile - memory tools won't work)
      systemPrompt = options.systemPrompt;
    }

    // Initialize SkillManager (enabled by default)
    if (options.enableSkills !== false) {
      this.skillManager = new SkillManager({
        profileId: options.profileId,
        profileBaseDir: options.profileBaseDir,
        config: options.skills,
      });

      // Append skills prompt to system prompt
      const skillsPrompt = this.skillManager.buildSkillsPrompt();
      if (skillsPrompt) {
        systemPrompt = systemPrompt ? `${systemPrompt}\n\n${skillsPrompt}` : skillsPrompt;
      }
    }

    // Set the combined system prompt
    if (systemPrompt) {
      this.agent.setSystemPrompt(systemPrompt);
    }

    this.sessionId = options.sessionId ?? uuidv7();

    // 解析 model（用于获取 context window）
    const storedMeta = (() => {
      // 临时创建 session 获取 meta，避免循环依赖
      const tempSession = new SessionManager({ sessionId: this.sessionId });
      return tempSession.getMeta();
    })();

    const effectiveProvider = resolvedModel ? resolvedProvider : (options.provider ?? storedMeta?.provider);
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
      stderr.write(
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

    // 确定 compaction 模式
    const compactionMode = options.compactionMode ?? "tokens"; // 默认使用 token 模式

    // 获取 API Key（用于 summary 模式）
    const summaryApiKey = compactionMode === "summary" ? resolveApiKey(model.provider, options.apiKey) : undefined;

    // 创建 SessionManager（带 context window 配置）
    this.session = new SessionManager({
      sessionId: this.sessionId,
      compactionMode,
      // Token 模式参数
      contextWindowTokens: this.contextWindowGuard.tokens,
      systemPrompt,
      reserveTokens: options.reserveTokens,
      targetRatio: options.compactionTargetRatio,
      minKeepMessages: options.minKeepMessages,
      // Summary 模式参数
      model: compactionMode === "summary" ? model : undefined,
      apiKey: summaryApiKey,
      customInstructions: options.summaryInstructions,
    });

    if (!options.thinkingLevel && storedMeta?.thinkingLevel) {
      this.agent.setThinkingLevel(storedMeta.thinkingLevel as any);
    } else if (options.thinkingLevel) {
      this.agent.setThinkingLevel(options.thinkingLevel);
    }

    this.agent.setModel(model);

    // Save original tools config from options (for later merging during reload)
    this.originalToolsConfig = options.tools;

    // Merge Profile tools config with options.tools (options takes precedence)
    const profileToolsConfig = this.profile?.getToolsConfig();
    const mergedToolsConfig = mergeToolsConfig(profileToolsConfig, options.tools);
    this.toolsOptions = mergedToolsConfig ? { ...options, tools: mergedToolsConfig } : options;

    const tools = resolveTools(this.toolsOptions);
    if (this.debug) {
      if (profileToolsConfig) {
        console.error(`[debug] Profile tools config: ${JSON.stringify(profileToolsConfig)}`);
      }
      console.error(`[debug] Merged tools config: ${JSON.stringify(mergedToolsConfig)}`);
      console.error(`[debug] Resolved ${tools.length} tools: ${tools.map(t => t.name).join(", ") || "(none)"}`);
    }
    this.agent.setTools(tools);

    const restoredMessages = this.session.loadMessages();
    if (restoredMessages.length > 0) {
      if (this.debug) {
        console.error(`[debug] Restoring ${restoredMessages.length} messages from session`);
        for (const msg of restoredMessages) {
          const msgAny = msg as any;
          const content = Array.isArray(msgAny.content)
            ? msgAny.content.map((c: any) => c.type || "text").join(", ")
            : typeof msgAny.content;
          console.error(`[debug]   ${msg.role}: ${content}`);
          if (Array.isArray(msgAny.content)) {
            for (const block of msgAny.content) {
              if (block.type === "tool_use") {
                console.error(`[debug]     tool_use id: ${block.id}, name: ${block.name}`);
              }
              if (block.type === "tool_result") {
                console.error(`[debug]     tool_result tool_use_id: ${block.tool_use_id}`);
              }
            }
          }
        }
      }
      this.agent.replaceMessages(restoredMessages);
    }

    this.session.saveMeta({
      provider: this.agent.state.model?.provider,
      model: this.agent.state.model?.id,
      thinkingLevel: this.agent.state.thinkingLevel,
      contextWindowTokens: this.contextWindowGuard.tokens,
    });

    this.agent.subscribe((event: AgentEvent) => {
      this.output.handleEvent(event);
      this.handleSessionEvent(event);
    });
  }

  /** Subscribe to agent events (returns unsubscribe function) */
  subscribe(fn: (event: AgentEvent) => void): () => void {
    return this.agent.subscribe(fn);
  }

  async run(prompt: string): Promise<AgentRunResult> {
    this.output.state.lastAssistantText = "";
    await this.agent.prompt(prompt);
    return { text: this.output.state.lastAssistantText, error: this.agent.state.error };
  }

  private handleSessionEvent(event: AgentEvent) {
    if (event.type === "message_end") {
      const message = event.message as AgentMessage;
      this.session.saveMessage(message);
      if (message.role === "assistant") {
        void this.maybeCompact();
      }
    }
  }

  private async maybeCompact() {
    const messages = this.agent.state.messages.slice();
    const result = await this.session.maybeCompact(messages);
    if (result?.kept) {
      this.agent.replaceMessages(result.kept);
    }
  }

  /**
   * Reload tools from profile config.
   * Call this after updating tool status to apply changes
   * without restarting the agent session.
   */
  reloadTools(): string[] {
    // Re-read profile tools config to get latest changes
    const profileToolsConfig = this.profile?.getToolsConfig();
    const mergedToolsConfig = mergeToolsConfig(profileToolsConfig, this.originalToolsConfig);
    this.toolsOptions = mergedToolsConfig
      ? { ...this.toolsOptions, tools: mergedToolsConfig }
      : this.toolsOptions;

    const tools = resolveTools(this.toolsOptions);
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
}
