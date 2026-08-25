/**
 * Custom per-model pricing overrides (iteration-103, MYS-712) — mobile mirror
 * of web packages/core/runtimes/custom-pricing-store.ts. Lets users fill in
 * USD/1M rates for models the app has no maintained price for; estimateCost
 * (lib/runtime-usage.ts) consults this store after the rate table, same order
 * as web's resolvePricing.
 *
 * Persistence: in-memory zustand store for this session (the issue scope says
 * "内存 zustand store + 可选 AsyncStorage"; mobile ships no async-storage
 * dependency, so overrides last for the app lifetime). The store is keyed by
 * pricing key (provider-qualified, see pricingKey in runtime-usage.ts), so
 * `cursor/auto` and bare `auto` never collide.
 */
import { create } from "zustand";

export interface CustomModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

interface CustomPricingState {
  pricings: Record<string, CustomModelPricing>;
  setCustomPricing: (model: string, pricing: CustomModelPricing) => void;
  removeCustomPricing: (model: string) => void;
}

export const useCustomPricingStore = create<CustomPricingState>((set) => ({
  pricings: {},
  setCustomPricing: (model, pricing) =>
    set((state) => ({
      pricings: { ...state.pricings, [model]: pricing },
    })),
  removeCustomPricing: (model) =>
    set((state) => {
      if (!(model in state.pricings)) return state;
      const next = { ...state.pricings };
      delete next[model];
      return { pricings: next };
    }),
}));

/** Vanilla accessor for non-React callers (cost estimation in runtime-usage). */
export function getCustomPricing(model: string): CustomModelPricing | undefined {
  return useCustomPricingStore.getState().pricings[model];
}

/** Convenience wrappers for the dialog / tests. */
export function setCustomPricing(
  model: string,
  pricing: CustomModelPricing,
): void {
  useCustomPricingStore.getState().setCustomPricing(model, pricing);
}

export function removeCustomPricing(model: string): void {
  useCustomPricingStore.getState().removeCustomPricing(model);
}

/** Test-only: clear all overrides. */
export function resetCustomPricingForTests(): void {
  useCustomPricingStore.setState({ pricings: {} });
}