/**
 * Decision logic for binding a Multica agent to an external chat platform
 * (iteration 170) — the write half of the agent Integrations screen.
 *
 * Two shapes live here, both ported from web so a bind that works in the
 * browser works on a phone:
 *
 *   1. Lark binds through a device flow: `begin` opens a session against the
 *      chosen cloud, the app shows the URL and polls `status` until it turns
 *      success or error. Everything that decides what the next poll does —
 *      the cadence clamp, the status → outcome switch, the `error_reason` →
 *      copy mapping, which HTTP failures are terminal — is a pure function of
 *      the server's reply (web: packages/views/settings/components/
 *      lark-tab.tsx:726-812).
 *
 *   2. Slack / DingTalk / WeCom bind bring-your-own-app: the admin pastes
 *      credentials from the vendor console. Web validates them by trimming
 *      and checking non-empty (slack-tab.tsx:329-352 and siblings); the
 *      server additionally rejects a Slack token without its documented
 *      prefix (slack/byo_install.go:61,182), so the same check runs here and
 *      turns a round-trip 400 into a field-level message.
 *
 * Pure and React-free so the Node-only vitest lane can pin it.
 */
import type {
  RegisterDingTalkBYORequest,
  RegisterSlackBYORequest,
  RegisterWecomBYORequest,
} from "@multica/core/types";

/** The channels an agent can be bound to. Lark is the odd one out: it has a
 *  device flow rather than a credentials form. */
export type BindChannel = "lark" | "slack" | "dingtalk" | "wecom";

/** The three bring-your-own-app channels. */
export type ByoChannel = Exclude<BindChannel, "lark">;

// ---------------------------------------------------------------------------
// Lark device flow
// ---------------------------------------------------------------------------

/** Web's floor for the device-flow poll cadence (lark-tab.tsx:744). The
 *  server suggests a value; a suggestion below this — or a nonsense one —
 *  would otherwise become a hot loop against the install endpoint. */
export const LARK_POLL_FLOOR_MS = 2000;

/**
 * The poll cadence to actually use, in milliseconds.
 *
 * Clamped up to `LARK_POLL_FLOOR_MS` for anything below it, and used verbatim
 * above it. A missing / non-finite value (an older server that omits the
 * field, a session object that failed to parse) falls back to the floor
 * rather than to `NaN`, which would make `setTimeout` fire immediately and
 * spin.
 */
export function larkPollIntervalMs(pollIntervalSeconds: number | null | undefined): number {
  if (pollIntervalSeconds == null || !Number.isFinite(pollIntervalSeconds)) {
    return LARK_POLL_FLOOR_MS;
  }
  return Math.max(LARK_POLL_FLOOR_MS, Math.round(pollIntervalSeconds * 1000));
}

/**
 * `error_reason` → i18n key.
 *
 * The server's stable codes (packages/core/types/lark.ts:62-66) each get
 * their own copy; anything unrecognised — including the `internal_error` the
 * server does document, which is not actionable — collapses to the generic
 * message. `session_lost` / `forbidden` are not server codes at all: the
 * client raises them when a poll itself fails terminally.
 */
export function larkInstallErrorKey(reason: string | null | undefined): string {
  switch (reason) {
    case "expired":
      return "agents.integrations.larkErrorExpired";
    case "access_denied":
      return "agents.integrations.larkErrorAccessDenied";
    case "lark_protocol_error":
      return "agents.integrations.larkErrorProtocol";
    case "bot_info_failed":
      return "agents.integrations.larkErrorBotInfo";
    case "installation_conflict":
      return "agents.integrations.larkErrorConflict";
    case "installer_bind_failed":
      return "agents.integrations.larkErrorInstallerBind";
    case "session_lost":
      return "agents.integrations.larkErrorSessionLost";
    case "forbidden":
      return "agents.integrations.larkErrorForbidden";
    default:
      return "agents.integrations.larkErrorGeneric";
  }
}

/** What one status poll means for the loop. */
export type LarkPollOutcome =
  | { kind: "pending" }
  | { kind: "success" }
  | { kind: "error"; errorKey: string };

/**
 * Read a status response.
 *
 * Anything that is neither `success` nor `error` keeps polling — including a
 * lifecycle value this build has never seen. Stopping on an unknown status
 * would strand the user on a stale URL with no error and no way forward,
 * whereas polling costs one more request and lets the server's own expiry
 * end the session.
 */
export function larkPollOutcome(
  status: string | null | undefined,
  errorReason: string | null | undefined,
): LarkPollOutcome {
  if (status === "success") return { kind: "success" };
  if (status === "error") {
    return { kind: "error", errorKey: larkInstallErrorKey(errorReason) };
  }
  return { kind: "pending" };
}

/**
 * An HTTP failure during a poll: the copy key when it is terminal, or `null`
 * when the loop should try again.
 *
 * 404 means the session is gone (server restarted, another instance answered,
 * the in-process sweep collected it) and 401/403 means permission went away
 * mid-session — in both cases a fresh QR is the only way forward, so retrying
 * would just hide the failure behind a spinner. Everything else (network
 * blip, 5xx, a rate limit) is transient and gets another poll
 * (web: lark-tab.tsx:776-803).
 */
export function larkPollHttpErrorKey(httpStatus: number): string | null {
  if (httpStatus === 404) return "agents.integrations.larkErrorSessionLost";
  if (httpStatus === 403 || httpStatus === 401) {
    return "agents.integrations.larkErrorForbidden";
  }
  return null;
}

// ---------------------------------------------------------------------------
// Bring-your-own-app forms
// ---------------------------------------------------------------------------

/** One field of a BYO form, in the order web renders it. */
interface ByoField {
  name: string;
  /** Rejected when empty after trimming. */
  required: boolean;
  /** Rejected when non-empty but missing this prefix (Slack only). */
  prefix?: string;
  prefixErrorKey?: string;
}

const BYO_FIELDS: Record<ByoChannel, ByoField[]> = {
  // The server checks both prefixes itself (slack/byo_install.go:61,182) and
  // answers 400, so failing here is the same verdict one round-trip earlier.
  slack: [
    {
      name: "bot_token",
      required: true,
      prefix: "xoxb-",
      prefixErrorKey: "agents.integrations.byoSlackBotPrefix",
    },
    {
      name: "app_token",
      required: true,
      prefix: "xapp-",
      prefixErrorKey: "agents.integrations.byoSlackAppPrefix",
    },
  ],
  dingtalk: [
    { name: "client_id", required: true },
    { name: "client_secret", required: true },
  ],
  wecom: [
    { name: "bot_id", required: true },
    { name: "secret", required: true },
    // Optional: it only helps the bot recognise its own @-mention, and
    // omitting it preserves the name already stored.
    { name: "bot_name", required: false },
  ],
};

/** Form values, keyed by field name. */
export type ByoFormValues = Record<string, string | undefined>;

function trimmed(values: ByoFormValues, field: string): string {
  return (values[field] ?? "").trim();
}

/**
 * Field name → i18n key for everything wrong with the form. Empty object
 * means submittable.
 *
 * A field is reported at most once, and the prefix check only runs on a
 * non-empty value — an empty bot token is "required", not "missing the
 * xoxb- prefix", which is the more useful of the two messages.
 */
export function byoFieldErrors(
  channel: ByoChannel,
  values: ByoFormValues,
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of BYO_FIELDS[channel]) {
    const value = trimmed(values, field.name);
    if (!value) {
      if (field.required) errors[field.name] = "agents.integrations.byoRequired";
      continue;
    }
    if (field.prefix && !value.startsWith(field.prefix)) {
      errors[field.name] = field.prefixErrorKey ?? "agents.integrations.byoRequired";
    }
  }
  return errors;
}

/** Whether the submit button should be enabled. */
export function isByoSubmittable(channel: ByoChannel, values: ByoFormValues): boolean {
  return Object.keys(byoFieldErrors(channel, values)).length === 0;
}

/**
 * The exact request body to POST for a channel.
 *
 * Values are trimmed, because that is what web sends (slack-tab.tsx:329-330,
 * dingtalk-tab.tsx:542-543, wecom-tab.tsx:301-303) and a trailing newline
 * pasted from a console is otherwise stored as part of a secret. WeCom's
 * optional `bot_name` is omitted rather than sent empty, so a re-install of
 * the same bot keeps the name already stored instead of clearing it.
 */
/** The wire request shape a channel's form produces. */
export type ByoRequestFor<C extends ByoChannel> = C extends "slack"
  ? RegisterSlackBYORequest
  : C extends "dingtalk"
    ? RegisterDingTalkBYORequest
    : RegisterWecomBYORequest;

export function byoRequestBody<C extends ByoChannel>(
  channel: C,
  values: ByoFormValues,
): ByoRequestFor<C> {
  let body: Record<string, string>;
  switch (channel) {
    case "slack":
      body = {
        bot_token: trimmed(values, "bot_token"),
        app_token: trimmed(values, "app_token"),
      };
      break;
    case "dingtalk":
      body = {
        client_id: trimmed(values, "client_id"),
        client_secret: trimmed(values, "client_secret"),
      };
      break;
    default: {
      body = {
        bot_id: trimmed(values, "bot_id"),
        secret: trimmed(values, "secret"),
      };
      const botName = trimmed(values, "bot_name");
      if (botName) body.bot_name = botName;
      break;
    }
  }
  return body as unknown as ByoRequestFor<C>;
}

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

interface InstallationLike {
  id: string;
  agent_id: string;
  status: string;
}

/**
 * The installation a "Disconnect" tap on this agent's card should revoke, or
 * `null` when there is nothing to revoke.
 *
 * Only an ACTIVE row counts: revoked rows are kept for audit and are not a
 * connection, so offering to disconnect one would be a no-op the user cannot
 * explain. Scoped to `agentId` because the listing is workspace-wide.
 */
export function disconnectTarget<T extends InstallationLike>(
  installations: T[] | undefined,
  agentId: string,
): T | null {
  return (
    installations?.find(
      (inst) => inst.agent_id === agentId && inst.status === "active",
    ) ?? null
  );
}
