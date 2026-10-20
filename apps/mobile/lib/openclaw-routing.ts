/**
 * Form model for the OpenClaw routing config editor — the mobile port of
 * web's `runtime-config-tab.tsx` (`packages/views/agents/components/tabs/`).
 *
 * The WIRE schema is not reimplemented here. `parseOpenclawRuntimeConfig` /
 * `serializeOpenclawRuntimeConfig` / `openclawRuntimeConfigEquals` live in
 * `packages/core/agents/openclaw-runtime-config.ts` and are imported through
 * `@multica/core/agents`; the daemon decodes the same schema in
 * `server/internal/daemon/openclaw_runtime_config.go`, so a second copy of the
 * shape here would drift from the Go side on the first field rename.
 *
 * What DOES belong here is the seam web keeps inside its component: the
 * conversion between the typed config and the STRING-based form state a text
 * input can hold, plus the two rules that are easy to get wrong and invisible
 * when you do:
 *
 *  1. **The mask sentinel never reaches the input.** The API substitutes
 *     `OPENCLAW_GATEWAY_TOKEN_MASK` ("***") for every non-empty stored token on
 *     read, and treats the same sentinel on write as "keep the persisted
 *     value". Putting "***" in the field invites the user to "fix" it into a
 *     real token by hand; web instead shows an EMPTY field with a "saved"
 *     placeholder and remembers the masked state out of band
 *     (`configToForm`, `runtime-config-tab.tsx:57-72`). `tokenWasMasked`
 *     carries that memory, and any keystroke clears it (`:250-262`).
 *
 *  2. **Switching routing mode drops `tokenWasMasked`.** Without this, a
 *     gateway → local → gateway round trip re-arms the "replay the sentinel"
 *     branch in `formToConfig` and silently restores a token the user had no
 *     intention of keeping (web spells this out at `:177-190`).
 *
 * Port validity is its own predicate rather than a render-time regex: the port
 * field is a string while being edited, an empty string is LEGAL (it means
 * "inherit the daemon host's ~/.openclaw/openclaw.json"), and Save must be
 * disabled — not silently coerced — on anything else.
 */
import {
  OPENCLAW_GATEWAY_TOKEN_MASK,
  openclawRuntimeConfigEquals,
  type OpenclawRoutingMode,
  type OpenclawRuntimeConfig,
} from "@multica/core/agents";

/**
 * Editor state. Mirrors `OpenclawRuntimeConfig` but every field is a string or
 * boolean a control can bind to, and `mode` is always defined so the segmented
 * control is fully controlled.
 */
export interface OpenclawRoutingForm {
  mode: OpenclawRoutingMode;
  host: string;
  port: string;
  token: string;
  tls: boolean;
  /**
   * True while the form opened against a persisted token (the server answered
   * with the mask sentinel) AND the user has not touched the field since.
   * Submit replays the sentinel back so the server's preserve hook keeps the
   * stored value; a keystroke flips this false so an empty field genuinely
   * clears the token.
   */
  tokenWasMasked: boolean;
}

/** Seed the editor from a parsed config. `mode` defaults to "local" — the
 *  daemon's own fail-soft default, so the control is never unset. */
export function routingConfigToForm(
  cfg: OpenclawRuntimeConfig,
): OpenclawRoutingForm {
  const masked = cfg.gateway?.token === OPENCLAW_GATEWAY_TOKEN_MASK;
  return {
    mode: cfg.mode ?? "local",
    host: cfg.gateway?.host ?? "",
    // Never display the sentinel: an empty field plus the "saved" placeholder
    // is what stops a user from editing the mask by accident.
    port: cfg.gateway?.port ? String(cfg.gateway.port) : "",
    token: masked ? "" : (cfg.gateway?.token ?? ""),
    tls: cfg.gateway?.tls === true,
    tokenWasMasked: masked,
  };
}

/**
 * Render the editor back into the typed config.
 *
 * Gateway fields are only read in gateway mode — switching to local and
 * submitting therefore clears the endpoint block rather than leaving a stale
 * one behind, which is what "Local" claims.
 */
export function routingFormToConfig(
  state: OpenclawRoutingForm,
): OpenclawRuntimeConfig {
  const cfg: OpenclawRuntimeConfig = { mode: state.mode };
  if (state.mode !== "gateway") return cfg;

  const gw: NonNullable<OpenclawRuntimeConfig["gateway"]> = {};
  const host = state.host.trim();
  if (host !== "") gw.host = host;

  const port = Number.parseInt(state.port, 10);
  if (Number.isFinite(port) && port > 0) gw.port = port;

  if (state.tls) gw.tls = true;

  if (state.tokenWasMasked && state.token === "") {
    // Untouched saved token: replay the sentinel so the server keeps it. The
    // value also has to sit on the TYPED object, or the equality check below
    // would report the form as dirty against a config that never changed.
    gw.token = OPENCLAW_GATEWAY_TOKEN_MASK;
  } else if (state.token !== "") {
    gw.token = state.token;
  }

  if (Object.keys(gw).length > 0) cfg.gateway = gw;
  return cfg;
}

/**
 * Port field validity. Empty is valid (inherit from the daemon host); anything
 * that is not a plain digit string is not, so "80a" or "-1" disable Save
 * instead of being truncated into a port the user never typed.
 */
export function isRoutingPortValid(port: string): boolean {
  return port === "" || /^\d+$/.test(port);
}

/**
 * Whether the form differs from the server's config. Delegates to core's
 * `openclawRuntimeConfigEquals`, which treats an absent gateway block and an
 * empty one as identical — otherwise toggling local→gateway without filling
 * anything in would claim unsaved work that does not exist.
 */
export function isRoutingFormDirty(
  original: OpenclawRuntimeConfig,
  state: OpenclawRoutingForm,
): boolean {
  return !openclawRuntimeConfigEquals(original, routingFormToConfig(state));
}

/**
 * Whether Save may fire: something changed, the port parses, and the agent row
 * came out of a SETTLED read.
 *
 * `readSettled` is the same gate the custom-args editor needed (MYS-1910):
 * `PUT /api/agents/{id}` replaces `runtime_config` wholesale, so saving from a
 * form seeded off a failed read would write a config derived from nothing over
 * whatever the server actually holds.
 */
export function canSaveRouting({
  dirty,
  portValid,
  readSettled,
  saving = false,
}: {
  dirty: boolean;
  portValid: boolean;
  readSettled: boolean;
  saving?: boolean;
}): boolean {
  return dirty && portValid && readSettled && !saving;
}

/**
 * The gateway endpoint block is only editable in gateway mode. Kept as a named
 * predicate so the "Local" disabled treatment is one decision rather than four
 * scattered `disabled={mode !== "gateway"}` attributes that can drift apart.
 */
export function isGatewayBlockEnabled(state: OpenclawRoutingForm): boolean {
  return state.mode === "gateway";
}
