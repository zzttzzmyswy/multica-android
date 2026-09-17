/**
 * Tests for the mobile runtime-models data layer (iteration 121, MYS-1032).
 * Mirrors the semantics of packages/core/runtimes/models.ts +
 * packages/core/api/client.ts initiateListModels/getListModelsResult:
 *  - POST /api/runtimes/:id/models initiates, GET .../models/:requestId polls.
 *  - status drives the poll loop (pending/running → keep polling).
 *  - Only an explicit `completed` is a catalog; failed/timeout/unknown is an
 *    error that keeps manual entry alive.
 *  - `supported` gates picker usability (defaults true when omitted).
 *  - Malformed responses degrade to the MALFORMED record (status "failed").
 * Plus the form-side pure logic: capability lookup, override-visibility and
 * custom-entry matching used by the model picker on the create/edit form.
 */
import { describe, expect, it } from "vitest";
import {
  RuntimeModelListRequestSchema,
  MALFORMED_RUNTIME_MODEL_LIST_REQUEST,
} from "@multica/core/api/schemas";
import type { RuntimeModel } from "@multica/core/types";
import {
  findModelEntry,
  modelOverrideOptions,
  shouldShowOverrides,
  canUseCatalogPicker,
} from "./runtime-models";

const MODEL_A: RuntimeModel = {
  id: "gpt-5.4",
  label: "GPT 5.4",
  provider: "openai",
  default: true,
  thinking: {
    supported_levels: [
      { value: "low", label: "Low" },
      { value: "high", label: "High" },
    ],
    default_level: "medium",
  },
  service_tiers: [
    { id: "priority", name: "Priority" },
    { id: "flex", name: "Flex" },
  ],
};

const MODEL_B: RuntimeModel = {
  id: "claude-opus-5",
  label: "Claude Opus 5",
  provider: "anthropic",
};

const BASE_CLAUDE_MODELS = [MODEL_B];

describe("RuntimeModelListRequestSchema", () => {
  it("parses a completed catalog", () => {
    const parsed = RuntimeModelListRequestSchema.parse({
      id: "req-1",
      runtime_id: "rt-1",
      status: "completed",
      models: [MODEL_A],
      supported: true,
    });
    expect(parsed.status).toBe("completed");
    expect(parsed.models).toHaveLength(1);
    expect(parsed.models?.[0].thinking?.supported_levels).toHaveLength(2);
  });

  it("defaults supported=true when a legacy server omits it", () => {
    const parsed = RuntimeModelListRequestSchema.parse({
      status: "completed",
      models: [],
    });
    expect(parsed.supported).toBe(true);
  });

  it("keeps unknown status values as strings (newer server)", () => {
    const parsed = RuntimeModelListRequestSchema.parse({
      status: "quantum-syncing",
    });
    expect(parsed.status).toBe("quantum-syncing");
  });
});

describe("MALFORMED_RUNTIME_MODEL_LIST_REQUEST fallback", () => {
  it("is an explicit failure, not a fake catalog", () => {
    expect(MALFORMED_RUNTIME_MODEL_LIST_REQUEST.status).toBe("failed");
    expect(MALFORMED_RUNTIME_MODEL_LIST_REQUEST.supported).toBe(true);
    expect(MALFORMED_RUNTIME_MODEL_LIST_REQUEST.error).toBeTruthy();
  });
});

describe("findModelEntry", () => {
  const models = [MODEL_A, MODEL_B];

  it("matches by exact id", () => {
    expect(findModelEntry(models, "gpt-5.4", "openai")?.id).toBe("gpt-5.4");
  });

  it("normalizes the claude context-window tag so the base-id entry matches", () => {
    // A persisted "claude-opus-5[1m]" finds a catalog entry whose id is the
    // bare base id ("claude-opus-5"), mirroring web model-capability.ts —
    // the normalization strips the tag from the lookup, never from the
    // catalog entry.
    expect(findModelEntry(BASE_CLAUDE_MODELS, "claude-opus-5[1m]", "claude")?.id).toBe(
      "claude-opus-5",
    );
  });

  it("keeps malformed claude tags fail-closed", () => {
    expect(findModelEntry(BASE_CLAUDE_MODELS, "claude-opus-5[weird]", "claude")).toBeUndefined();
  });

  it("does not normalize for non-claude providers", () => {
    expect(findModelEntry(models, "gpt-5.4[1m]", "openai")).toBeUndefined();
  });

  it("returns undefined for empty model", () => {
    expect(findModelEntry(models, "", "openai")).toBeUndefined();
  });
});

describe("modelOverrideOptions", () => {
  it("returns thinking levels and tiers of the exact entry", () => {
    const o = modelOverrideOptions([MODEL_A, MODEL_B], "gpt-5.4", "openai");
    expect(o.thinkingLevels.map((l) => l.value)).toEqual(["low", "high"]);
    expect(o.serviceTiers.map((t) => t.id)).toEqual(["priority", "flex"]);
  });

  it("returns empty options for a model with no capabilities", () => {
    const o = modelOverrideOptions([MODEL_A, MODEL_B], "claude-opus-5[1m]", "claude");
    expect(o.thinkingLevels).toEqual([]);
    expect(o.serviceTiers).toEqual([]);
  });

  it("returns empty options for an unknown model id", () => {
    const o = modelOverrideOptions([MODEL_A], "not-in-catalog", "openai");
    expect(o.thinkingLevels).toEqual([]);
    expect(o.serviceTiers).toEqual([]);
  });
});

describe("shouldShowOverrides", () => {
  it("hides when no options and no persisted value", () => {
    expect(
      shouldShowOverrides({ thinkingLevels: [], serviceTiers: [] }, "", ""),
    ).toBe(false);
  });

  it("shows when options exist", () => {
    expect(
      shouldShowOverrides(
        { thinkingLevels: MODEL_A.thinking!.supported_levels, serviceTiers: [] },
        "high",
        "",
      ),
    ).toBe(true);
  });

  it("shows when a value is persisted even without options (clearable orphan)", () => {
    expect(
      shouldShowOverrides({ thinkingLevels: [], serviceTiers: [] }, "ultra", ""),
    ).toBe(true);
  });
});

describe("canUseCatalogPicker", () => {
  it("enabled when runtime online and query not loading", () => {
    expect(
      canUseCatalogPicker({
        runtimeOnline: true,
        runtimeId: "rt-1",
        loading: false,
        error: false,
      }),
    ).toBe(true);
  });

  it("disabled without a runtime id", () => {
    expect(
      canUseCatalogPicker({
        runtimeOnline: true,
        runtimeId: null,
        loading: false,
        error: false,
      }),
    ).toBe(false);
  });

  it("disabled when runtime offline", () => {
    expect(
      canUseCatalogPicker({
        runtimeOnline: false,
        runtimeId: "rt-1",
        loading: false,
        error: false,
      }),
    ).toBe(false);
  });

  it("still enabled while loading (spinner in sheet, not dead trigger)", () => {
    expect(
      canUseCatalogPicker({
        runtimeOnline: true,
        runtimeId: "rt-1",
        loading: true,
        error: false,
      }),
    ).toBe(true);
  });
});
