import { describe, expect, it } from "vitest";
import {
  OPENCLAW_GATEWAY_TOKEN_MASK,
  parseOpenclawRuntimeConfig,
  serializeOpenclawRuntimeConfig,
} from "@multica/core/agents";
import {
  canSaveRouting,
  isGatewayBlockEnabled,
  isRoutingFormDirty,
  isRoutingPortValid,
  routingConfigToForm,
  routingFormToConfig,
  type OpenclawRoutingForm,
} from "./openclaw-routing";

const baseForm = (
  overrides: Partial<OpenclawRoutingForm> = {},
): OpenclawRoutingForm => ({
  mode: "gateway",
  host: "gw.internal",
  port: "18789",
  token: "",
  tls: false,
  tokenWasMasked: false,
  ...overrides,
});

describe("routingConfigToForm", () => {
  it("defaults the mode to local so the control is never unset", () => {
    // The daemon's own fail-soft default: an absent config means "run here".
    expect(routingConfigToForm({}).mode).toBe("local");
  });

  it("never puts the mask sentinel in the token field", () => {
    // The API substitutes the sentinel for every stored token. Rendering it
    // invites the user to "fix" it by hand into a token the gateway rejects;
    // web shows an empty field plus a distinct placeholder instead.
    const form = routingConfigToForm({
      mode: "gateway",
      gateway: { token: OPENCLAW_GATEWAY_TOKEN_MASK },
    });
    expect(form.token).toBe("");
    expect(form.tokenWasMasked).toBe(true);
  });

  it("keeps a real token visible in the field", () => {
    const form = routingConfigToForm({
      mode: "gateway",
      gateway: { token: "rotated-secret" },
    });
    expect(form.token).toBe("rotated-secret");
    expect(form.tokenWasMasked).toBe(false);
  });

  it("stringifies the port for the text input and leaves an absent one empty", () => {
    expect(
      routingConfigToForm({ mode: "gateway", gateway: { port: 18789 } }).port,
    ).toBe("18789");
    expect(routingConfigToForm({ mode: "gateway", gateway: {} }).port).toBe("");
  });

  it("carries host and tls through", () => {
    const form = routingConfigToForm({
      mode: "gateway",
      gateway: { host: "gw.internal", tls: true },
    });
    expect(form.host).toBe("gw.internal");
    expect(form.tls).toBe(true);
  });
});

describe("routingFormToConfig", () => {
  it("drops the gateway block entirely in local mode", () => {
    // "Local" claims the agent runs on this host. Submitting leftover endpoint
    // fields would leave a routing config that contradicts the mode.
    const cfg = routingFormToConfig(baseForm({ mode: "local" }));
    expect(cfg).toEqual({ mode: "local" });
    expect(cfg.gateway).toBeUndefined();
  });

  it("replays the mask sentinel when a saved token was never touched", () => {
    // The server's preserve hook keys off this exact value; omitting it reads
    // as "clear the token" and would silently drop a credential.
    const cfg = routingFormToConfig(
      baseForm({ token: "", tokenWasMasked: true }),
    );
    expect(cfg.gateway?.token).toBe(OPENCLAW_GATEWAY_TOKEN_MASK);
  });

  it("omits the token when the user emptied a masked field deliberately", () => {
    // A keystroke clears `tokenWasMasked`, so an empty value now means "clear
    // the persisted token" — the documented way to revoke one.
    const cfg = routingFormToConfig(
      baseForm({ token: "", tokenWasMasked: false }),
    );
    expect(cfg.gateway?.token).toBeUndefined();
  });

  it("trims the host and drops a whitespace-only one", () => {
    expect(
      routingFormToConfig(baseForm({ host: "  gw.internal  " })).gateway?.host,
    ).toBe("gw.internal");
    expect(routingFormToConfig(baseForm({ host: "   " })).gateway?.host).toBe(
      undefined,
    );
  });

  it("parses the port and drops a non-positive one", () => {
    expect(routingFormToConfig(baseForm({ port: "18789" })).gateway?.port).toBe(
      18789,
    );
    expect(
      routingFormToConfig(baseForm({ port: "0" })).gateway?.port,
    ).toBeUndefined();
    expect(
      routingFormToConfig(baseForm({ port: "" })).gateway?.port,
    ).toBeUndefined();
  });

  it("emits tls only when true, so a false value stays off the wire", () => {
    expect(
      routingFormToConfig(baseForm({ tls: true })).gateway?.tls,
    ).toBe(true);
    expect(
      routingFormToConfig(baseForm({ tls: false })).gateway?.tls,
    ).toBeUndefined();
  });

  it("collapses an empty gateway block away", () => {
    // A partial pin is legal: mode alone must not synthesize `gateway: {}`.
    const cfg = routingFormToConfig(
      baseForm({ host: "", port: "", tls: false, token: "" }),
    );
    expect(cfg).toEqual({ mode: "gateway" });
  });

  it("survives the core serializer unchanged", () => {
    // The serializer is core's, not ours: a round trip proves this module
    // emits a shape the daemon's decoder understands.
    const cfg = routingFormToConfig(baseForm({ tls: true, token: "secret" }));
    expect(serializeOpenclawRuntimeConfig(cfg)).toEqual({
      mode: "gateway",
      gateway: { host: "gw.internal", port: 18789, tls: true, token: "secret" },
    });
  });
});

describe("isRoutingPortValid", () => {
  it("accepts an empty port — it means 'inherit from the daemon host'", () => {
    expect(isRoutingPortValid("")).toBe(true);
  });

  it("accepts a plain digit string", () => {
    expect(isRoutingPortValid("18789")).toBe(true);
  });

  it("rejects anything with a non-digit, a sign or a decimal point", () => {
    for (const bad of ["80a", "-1", "1.5", " 80", "8 0", "0x50"]) {
      expect(isRoutingPortValid(bad), bad).toBe(false);
    }
  });
});

describe("isRoutingFormDirty", () => {
  it("is clean when the form matches the parsed config", () => {
    const original = parseOpenclawRuntimeConfig({
      mode: "gateway",
      gateway: { host: "gw.internal", port: 18789 },
    });
    expect(
      isRoutingFormDirty(
        original,
        baseForm({ mode: "gateway", host: "gw.internal", port: "18789" }),
      ),
    ).toBe(false);
  });

  it("is clean for an untouched masked token", () => {
    // The regression this guards: the sentinel never enters the field, so a
    // naive string comparison would report every agent with a saved token as
    // permanently dirty and enable Save on a config nobody changed.
    const original = parseOpenclawRuntimeConfig({
      mode: "gateway",
      gateway: { token: OPENCLAW_GATEWAY_TOKEN_MASK },
    });
    expect(
      isRoutingFormDirty(
        original,
        routingConfigToForm(original),
      ),
    ).toBe(false);
  });

  it("treats an absent gateway block and an empty one as identical", () => {
    // Toggling local → gateway without filling anything in is not unsaved work.
    expect(
      isRoutingFormDirty(
        { mode: "gateway" },
        baseForm({ host: "", port: "", tls: false, token: "" }),
      ),
    ).toBe(false);
  });

  it("turns dirty on a host edit", () => {
    expect(
      isRoutingFormDirty({ mode: "gateway" }, baseForm({ host: "other.host" })),
    ).toBe(true);
  });

  it("turns dirty on a mode switch that actually changes routing", () => {
    expect(
      isRoutingFormDirty(
        { mode: "gateway", gateway: { host: "gw.internal" } },
        baseForm({ mode: "local" }),
      ),
    ).toBe(true);
  });

  it("turns dirty when the token changes", () => {
    expect(
      isRoutingFormDirty(
        {
          mode: "gateway",
          gateway: { token: OPENCLAW_GATEWAY_TOKEN_MASK },
        },
        baseForm({ token: "new-secret" }),
      ),
    ).toBe(true);
  });
});

describe("canSaveRouting", () => {
  it("requires a change, a valid port and a settled read", () => {
    expect(
      canSaveRouting({ dirty: true, portValid: true, readSettled: true }),
    ).toBe(true);
  });

  it("refuses a clean form", () => {
    expect(
      canSaveRouting({ dirty: false, portValid: true, readSettled: true }),
    ).toBe(false);
  });

  it("refuses an unparseable port even when everything else is ready", () => {
    expect(
      canSaveRouting({ dirty: true, portValid: false, readSettled: true }),
    ).toBe(false);
  });

  it("refuses to save over a config it never read", () => {
    // `PUT /api/agents/{id}` replaces `runtime_config` wholesale, so seeding a
    // save from a failed read would overwrite the server's real config with a
    // value derived from nothing (the MYS-1910 data-loss shape).
    expect(
      canSaveRouting({ dirty: true, portValid: true, readSettled: false }),
    ).toBe(false);
  });

  it("refuses while a save is already in flight", () => {
    expect(
      canSaveRouting({
        dirty: true,
        portValid: true,
        readSettled: true,
        saving: true,
      }),
    ).toBe(false);
  });
});

describe("isGatewayBlockEnabled", () => {
  it("enables the endpoint block only in gateway mode", () => {
    expect(isGatewayBlockEnabled(baseForm({ mode: "gateway" }))).toBe(true);
    expect(isGatewayBlockEnabled(baseForm({ mode: "local" }))).toBe(false);
  });
});
