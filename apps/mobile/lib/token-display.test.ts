import { describe, expect, it } from "vitest";
import { tokenRowMeta } from "./token-display";

const identityLabels = {
  fmtDate: (iso: string) => iso,
  created: (d: string) => `Created ${d}`,
  lastUsedWithDate: (d: string) => `Last used ${d}`,
  lastUsedNever: "Never used",
  expiresWithDate: (d: string) => `Expires ${d}`,
};

describe("tokenRowMeta", () => {
  it("composes prefix + created + last used (never → label, expires omitted when null)", () => {
    const meta = tokenRowMeta(
      {
        token_prefix: "mca_abc",
        created_at: "2026-08-01T00:00:00Z",
        last_used_at: null,
        expires_at: null,
      },
      identityLabels,
    );
    expect(meta).toBe(
      "mca_abc… · Created 2026-08-01T00:00:00Z · Never used",
    );
  });

  it("appends expires as the trailing segment when present", () => {
    const meta = tokenRowMeta(
      {
        token_prefix: "mca_abc",
        created_at: "2026-08-01T00:00:00Z",
        last_used_at: "2026-08-10T00:00:00Z",
        expires_at: "2026-10-30T00:00:00Z",
      },
      identityLabels,
    );
    expect(meta).toBe(
      "mca_abc… · Created 2026-08-01T00:00:00Z · Last used 2026-08-10T00:00:00Z · Expires 2026-10-30T00:00:00Z",
    );
  });
});