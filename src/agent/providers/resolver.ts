/**
 * Provider Resolver
 *
 * Resolves provider configuration for making API calls,
 * including API keys, OAuth tokens, and model selection.
 */

import { getModel } from "@mariozechner/pi-ai";
import { credentialManager } from "../credentials.js";
import {
  readClaudeCliCredentials,
  readCodexCliCredentials,
} from "../oauth/cli-credentials.js";
import {
  PROVIDER_ALIAS,
  getProviderMeta,
  getDefaultModel,
  isOAuthProvider,
} from "./registry.js";
import type { AgentOptions } from "../types.js";

// ============================================================
// Types
// ============================================================

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
// Provider Config Resolution
// ============================================================

/**
 * Get provider config for making API calls.
 * Handles both OAuth and API Key authentication.
 */
export function resolveProviderConfig(providerId: string): ProviderConfig | null {
  const meta = getProviderMeta(providerId);
  if (!meta) return null;

  if (meta.authMethod === "oauth") {
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

// ============================================================
// API Key Resolution
// ============================================================

/**
 * Get API Key based on provider.
 * Priority: explicit key > OAuth credentials > credentials.json5 config.
 */
export function resolveApiKey(provider: string, explicitKey?: string): string | undefined {
  if (explicitKey) return explicitKey;

  // Try OAuth providers first (claude-code, openai-codex)
  const providerConfig = resolveProviderConfig(provider);
  if (providerConfig?.apiKey) {
    return providerConfig.apiKey;
  }
  if (providerConfig?.accessToken) {
    return providerConfig.accessToken;
  }

  // Fall back to credentials.json5
  return credentialManager.getLlmProviderConfig(provider)?.apiKey;
}

/**
 * Get Base URL based on provider.
 * Priority: explicit URL > credentials.json5 config.
 */
export function resolveBaseUrl(provider: string, explicitUrl?: string): string | undefined {
  if (explicitUrl) return explicitUrl;
  return credentialManager.getLlmProviderConfig(provider)?.baseUrl;
}

/**
 * Get Model ID based on provider.
 * Priority: explicit model > credentials.json5 config > default.
 */
export function resolveModelId(provider: string, explicitModel?: string): string | undefined {
  if (explicitModel) return explicitModel;
  return credentialManager.getLlmProviderConfig(provider)?.model ?? getDefaultModel(provider);
}

// ============================================================
// Model Resolution
// ============================================================

/**
 * Resolve model for pi-ai based on provider and options.
 */
export function resolveModel(options: AgentOptions) {
  if (options.provider && options.model) {
    // Map provider alias (e.g., claude-code -> anthropic)
    const actualProvider = PROVIDER_ALIAS[options.provider] ?? options.provider;

    // Type assertion needed because provider/model come from dynamic user config
    return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
      actualProvider,
      options.model,
    );
  }

  // If only provider specified, use default model for that provider
  if (options.provider) {
    const actualProvider = PROVIDER_ALIAS[options.provider] ?? options.provider;
    const defaultModel = getDefaultModel(options.provider) ?? getDefaultModel(actualProvider);
    if (defaultModel) {
      return (getModel as (p: string, m: string) => ReturnType<typeof getModel>)(
        actualProvider,
        defaultModel,
      );
    }
  }

  return getModel("kimi-coding", "kimi-k2-thinking");
}

// Re-export for convenience
export { isOAuthProvider };
