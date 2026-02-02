/**
 * Provider Management
 *
 * Manage LLM providers with support for:
 * - API Key authentication (traditional)
 * - OAuth authentication (Claude Code, Codex)
 */

import { credentialManager } from "../credentials.js";
import {
  readClaudeCliCredentials,
  readCodexCliCredentials,
  hasValidClaudeCliCredentials,
  hasValidCodexCliCredentials,
  type ClaudeCliCredential,
  type CodexCliCredential,
} from "./cli-credentials.js";

// ============================================================
// Types
// ============================================================

export type AuthMethod = "api-key" | "oauth";

export interface ProviderInfo {
  id: string;
  name: string;
  authMethod: AuthMethod;
  available: boolean;
  configured: boolean;
  current: boolean;
  models: string[];
  loginUrl?: string;
  loginCommand?: string;
}

export interface ProviderConfig {
  provider: string;
  model?: string | undefined;
  apiKey?: string | undefined;
  baseUrl?: string | undefined;
  // OAuth specific
  accessToken?: string | undefined;
  refreshToken?: string | undefined;
  expires?: number | undefined;
}

// ============================================================
// Provider Registry
// ============================================================

const PROVIDER_INFO: Record<string, Omit<ProviderInfo, "available" | "configured" | "current">> = {
  "anthropic": {
    id: "anthropic",
    name: "Anthropic (API Key)",
    authMethod: "api-key",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514", "claude-haiku-3-5-20241022"],
    loginUrl: "https://console.anthropic.com/",
  },
  "claude-code": {
    id: "claude-code",
    name: "Claude Code (OAuth)",
    authMethod: "oauth",
    models: ["claude-sonnet-4-20250514", "claude-opus-4-20250514"],
    loginCommand: "claude login",
  },
  "openai": {
    id: "openai",
    name: "OpenAI",
    authMethod: "api-key",
    models: ["gpt-4o", "gpt-4o-mini", "o1", "o1-mini"],
    loginUrl: "https://platform.openai.com/api-keys",
  },
  "openai-codex": {
    id: "openai-codex",
    name: "Codex (OAuth)",
    authMethod: "oauth",
    models: ["gpt-5.1", "gpt-5.1-codex-max"],
    loginCommand: "codex login",
  },
  "kimi-coding": {
    id: "kimi-coding",
    name: "Kimi Code",
    authMethod: "api-key",
    models: ["kimi-k2-thinking", "k2p5"],
    loginUrl: "https://kimi.moonshot.cn/",
  },
  "google": {
    id: "google",
    name: "Google AI",
    authMethod: "api-key",
    models: ["gemini-2.0-flash", "gemini-1.5-pro"],
    loginUrl: "https://aistudio.google.com/apikey",
  },
  "groq": {
    id: "groq",
    name: "Groq",
    authMethod: "api-key",
    models: ["llama-3.3-70b-versatile", "mixtral-8x7b-32768"],
    loginUrl: "https://console.groq.com/keys",
  },
  "mistral": {
    id: "mistral",
    name: "Mistral",
    authMethod: "api-key",
    models: ["mistral-large-latest", "codestral-latest"],
    loginUrl: "https://console.mistral.ai/api-keys",
  },
  "xai": {
    id: "xai",
    name: "xAI (Grok)",
    authMethod: "api-key",
    models: ["grok-beta", "grok-vision-beta"],
    loginUrl: "https://console.x.ai/",
  },
  "openrouter": {
    id: "openrouter",
    name: "OpenRouter",
    authMethod: "api-key",
    models: ["anthropic/claude-3.5-sonnet", "openai/gpt-4o"],
    loginUrl: "https://openrouter.ai/keys",
  },
};

// ============================================================
// Provider Status
// ============================================================

/**
 * Check if a provider is configured with API key in credentials.json5
 */
function isApiKeyConfigured(providerId: string): boolean {
  const config = credentialManager.getLlmProviderConfig(providerId);
  return !!config?.apiKey;
}

/**
 * Check if OAuth provider has valid credentials
 */
function isOAuthAvailable(providerId: string): boolean {
  if (providerId === "claude-code") {
    return hasValidClaudeCliCredentials();
  }
  if (providerId === "openai-codex") {
    return hasValidCodexCliCredentials();
  }
  return false;
}

/**
 * Get current provider from credentials
 */
export function getCurrentProvider(): string {
  return credentialManager.getLlmProvider() ?? "kimi-coding";
}

/**
 * Get list of all providers with their status
 */
export function getProviderList(): ProviderInfo[] {
  const currentProvider = getCurrentProvider();

  return Object.values(PROVIDER_INFO).map((info) => {
    const isOAuth = info.authMethod === "oauth";
    const available = isOAuth ? isOAuthAvailable(info.id) : isApiKeyConfigured(info.id);
    const configured = isOAuth ? isOAuthAvailable(info.id) : isApiKeyConfigured(info.id);

    // Check if this is the current provider
    // For claude-code, check if current is "anthropic" and OAuth is available
    let isCurrent = currentProvider === info.id;
    if (info.id === "claude-code" && currentProvider === "anthropic") {
      // If anthropic is current and claude-code OAuth is available, mark both
      isCurrent = hasValidClaudeCliCredentials();
    }

    return {
      ...info,
      available,
      configured,
      current: isCurrent,
    };
  });
}

/**
 * Get available providers only
 */
export function getAvailableProviders(): ProviderInfo[] {
  return getProviderList().filter((p) => p.available);
}

// ============================================================
// Provider Resolution
// ============================================================

/**
 * Get provider config for making API calls
 */
export function resolveProviderConfig(providerId: string): ProviderConfig | null {
  const info = PROVIDER_INFO[providerId];
  if (!info) return null;

  if (info.authMethod === "oauth") {
    if (providerId === "claude-code") {
      const creds = readClaudeCliCredentials();
      if (!creds) return null;

      const accessToken = creds.type === "oauth" ? creds.access : creds.token;
      return {
        provider: "anthropic", // Use anthropic API
        apiKey: accessToken,
        accessToken,
        refreshToken: creds.type === "oauth" ? creds.refresh : undefined,
        expires: creds.expires,
      };
    }

    if (providerId === "openai-codex") {
      const creds = readCodexCliCredentials();
      if (!creds) return null;

      return {
        provider: "openai-codex",
        accessToken: creds.access,
        refreshToken: creds.refresh,
        expires: creds.expires,
      };
    }
  }

  // API Key based
  const config = credentialManager.getLlmProviderConfig(providerId);
  if (!config?.apiKey) return null;

  return {
    provider: providerId,
    model: config.model,
    apiKey: config.apiKey,
    baseUrl: config.baseUrl,
  };
}

/**
 * Format provider for display
 */
export function formatProviderStatus(provider: ProviderInfo): string {
  const status = provider.available ? "✓" : "✗";
  const current = provider.current ? " (current)" : "";
  const auth = provider.authMethod === "oauth" ? " [OAuth]" : "";
  return `${status} ${provider.name}${auth}${current}`;
}

/**
 * Get login instructions for a provider
 */
export function getLoginInstructions(providerId: string): string {
  const info = PROVIDER_INFO[providerId];
  if (!info) return `Unknown provider: ${providerId}`;

  if (info.authMethod === "oauth") {
    if (info.loginCommand) {
      return `Run: ${info.loginCommand}\nThen restart Super Multica to use the credentials.`;
    }
  }

  if (info.loginUrl) {
    return `Get your API key at: ${info.loginUrl}\nThen add it to ~/.super-multica/credentials.json5`;
  }

  return "No login instructions available.";
}

/**
 * Check if a provider uses OAuth authentication
 */
export function isOAuthProvider(providerId: string): boolean {
  const info = PROVIDER_INFO[providerId];
  return info?.authMethod === "oauth";
}

/**
 * Check if provider is available (has valid credentials)
 */
export function isProviderAvailable(providerId: string): boolean {
  const info = PROVIDER_INFO[providerId];
  if (!info) return false;

  if (info.authMethod === "oauth") {
    return isOAuthAvailable(providerId);
  }
  return isApiKeyConfigured(providerId);
}
