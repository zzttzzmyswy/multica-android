/**
 * Mobile data layer for runtime model discovery (iteration 121, MYS-1032).
 *
 * Mirrors web:
 *  - packages/core/runtimes/models.ts — the POST + poll state machine and the
 *    "only an explicit `completed` is a catalog" rule.
 *  - packages/views/agents/components/inspector/model-capability.ts — the
 *    claude context-window-tag normalization for capability lookup.
 *  - packages/views/agents/components/inspector/thinking-prop-row.tsx +
 *    service-tier-setting-field.tsx — fail-closed override visibility
 *    (render only when the exact model advertises the capability, or a
 *    persisted value needs clearing).
 *
 * The wire endpoints live in data/api.ts (initiateListModels /
 * getListModelsResult, parseWithFallback against the shared core schema);
 * this module holds the pure decision logic so it is unit-testable without
 * React or a fetch mock.
 */
import type { RuntimeModel, RuntimeModelServiceTier, RuntimeModelThinkingLevel } from "@multica/core/types";

// Claude Code appends a context-window modifier to some runtime-native model
// IDs (for example, claude-opus-5[1m]). Restrict inheritance to a numeric
// context size so arbitrary bracketed variants remain fail-closed. Same
// constant as web model-capability.ts — kept local because that module lives
// in packages/views (not on the mobile sharing whitelist).
const CLAUDE_CONTEXT_WINDOW_TAG = /\[[1-9]\d*[km]\]$/;

export function modelIdForCapabilityLookup(
  provider: string,
  model: string,
): string {
  return provider === "claude"
    ? model.replace(CLAUDE_CONTEXT_WINDOW_TAG, "")
    : model;
}

/** Resolves the catalog entry used for capability display. The raw model
 *  remains the value persisted and sent to the runtime; only this lookup
 *  identity is normalized. */
export function findModelEntry(
  models: readonly RuntimeModel[],
  model: string,
  provider: string,
): RuntimeModel | undefined {
  if (!model) return undefined;
  const lookupId = modelIdForCapabilityLookup(provider, model);
  return models.find((entry) => entry.id === lookupId);
}

export interface ModelOverrideOptions {
  thinkingLevels: RuntimeModelThinkingLevel[];
  serviceTiers: RuntimeModelServiceTier[];
}

/** Override options advertised by the exact selected model. Empty for a model
 *  without capability metadata — the caller decides visibility. */
export function modelOverrideOptions(
  models: readonly RuntimeModel[],
  model: string,
  provider: string,
): ModelOverrideOptions {
  const entry = findModelEntry(models, model, provider);
  return {
    thinkingLevels: entry?.thinking?.supported_levels ?? [],
    serviceTiers: entry?.service_tiers ?? [],
  };
}

/** Fail-closed visibility for the thinking / speed fields: render only when
 *  the exact model's catalog advertises the capability, or a value is already
 *  persisted and needs clearing (an orphan must stay clearable). Mirrors
 *  `levels.length === 0 && !value → null` on web. */
export function shouldShowOverrides(
  options: ModelOverrideOptions,
  thinkingLevel: string,
  serviceTier: string,
): boolean {
  return (
    options.thinkingLevels.length > 0 ||
    options.serviceTiers.length > 0 ||
    thinkingLevel !== "" ||
    serviceTier !== ""
  );
}

export interface CatalogPickerGate {
  runtimeOnline: boolean;
  runtimeId: string | null;
  loading: boolean;
  error: boolean;
}

/** The catalog picker is usable when a runtime is selected AND online. While
 *  discovery is loading the trigger stays enabled (the sheet shows the
 *  spinner); an error degrades to manual entry but does not brick the
 *  trigger — the sheet renders the failure and the custom-input row. */
export function canUseCatalogPicker(gate: CatalogPickerGate): boolean {
  return Boolean(gate.runtimeId) && gate.runtimeOnline;
}
