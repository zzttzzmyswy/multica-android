/**
 * MCP server form ↔ config mapping (mobile mirror of
 * packages/views/agents/components/tabs/mcp-config-model.ts + the dialog's
 * configFromForm / formFromConfig — write-only library entries mean the form
 * re-supplies the config on every save).
 *
 * Taxonomy notes inherited from web:
 *  - `transport` is a server-driven summary string the API returns (stdlib:
 *    stdio/http/sse/unknown + whatever a newer backend invents). It is a
 *    DISPLAY classifier, never the authoritative `config.type`.
 *  - The guided form expresses exactly two transports (stdio / http) and
 *    saving from it REWRITES the entry (`configFromForm` emits
 *    `type: "http"` for anything http-shaped). Editing an entry whose summary
 *    transport is sse/unknown WOULD change its protocol, so those entries are
 *    not routed through the form — they open in the JSON editor instead
 *    (`editorModeForServer` / `formSupportsServer`).
 *  - Keys the form does not model survive a form edit: `formFromConfig`
 *    collects them into `extras` and `configFromForm` writes them back, so a
 *    form save can never silently drop a field it never showed.
 */

export type McpFormTransport = "stdio" | "http";

/** Which editor a server opens in — web's `EditorMode`. */
export type McpEditorMode = "form" | "json";

export type McpKeyValue = { key: string; value: string };

export interface McpFormState {
  transport: McpFormTransport;
  command: string;
  /** Space-separated argument tokens (mobile single-field input). */
  argsText: string;
  env: McpKeyValue[];
  url: string;
  headers: McpKeyValue[];
  /** Config keys the guided form has no field for, carried through a save
   *  untouched. Empty for a form that was never seeded from a saved config. */
  extras: Record<string, unknown>;
}

/** Keys `formFromConfig` pulls out of a config; everything else is `extras`. */
const MCP_FORM_KEYS = [
  "type",
  "command",
  "args",
  "env",
  "environment",
  "url",
  "headers",
] as const;

export const emptyMcpForm = (): McpFormState => ({
  transport: "stdio",
  command: "",
  argsText: "",
  env: [],
  url: "",
  headers: [],
  extras: {},
});

export function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** `transport` badge text — unknown values render as themselves. */
export function transportLabel(transport: string | undefined | null): string {
  switch (transport) {
    case "stdio":
      return "stdio";
    case "http":
      return "HTTP";
    case "sse":
      return "SSE";
    default:
      return transport || "unknown";
  }
}

/** Whether the guided form can express a server with this summary transport. */
export function formCanExpressTransport(transport: string): boolean {
  return transport === "stdio" || transport === "http";
}

function recordFromPairs(pairs: McpKeyValue[]): Record<string, string> | undefined {
  const entries = pairs
    .map(({ key, value }) => [key.trim(), value] as const)
    .filter(([key]) => key !== "");
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function pairsFromRecord(value: unknown): McpKeyValue[] {
  if (!isRecord(value)) return [];
  return Object.entries(value).flatMap(([key, item]) =>
    typeof item === "string" ? [{ key, value: item }] : [],
  );
}

/** Split a space-separated args field into tokens. */
export function splitArgsText(text: string): string[] {
  return text.trim().split(/\s+/).filter((token) => token !== "");
}

/** Join an args array back into a single space-separated field. */
export function joinArgs(args: unknown): string {
  if (!Array.isArray(args)) return "";
  return args.filter((value): value is string => typeof value === "string").join(" ");
}

/**
 * Form → write-only config. stdio emits `command` (required) + optional
 * `args`/`env`; http emits `type: "http"` + `url` (required) + optional
 * `headers`. `extras` is laid down first so a key the form has no field for
 * survives the save; the modelled keys then overwrite their own slots.
 */
export function configFromForm(form: McpFormState): Record<string, unknown> {
  const config: Record<string, unknown> = { ...form.extras };
  if (form.transport === "stdio") {
    config.command = form.command.trim();
    const args = splitArgsText(form.argsText);
    if (args.length > 0) config.args = args;
    const env = recordFromPairs(form.env);
    if (env) config.env = env;
  } else {
    config.type = "http";
    config.url = form.url.trim();
    const headers = recordFromPairs(form.headers);
    if (headers) config.headers = headers;
  }
  return config;
}

/**
 * Whether a saved config classifies as stdio for form purposes — web's
 * `mcpTransport` display classifier, which reports stdio for any entry with a
 * command (or an explicit local/stdio type) and http otherwise.
 */
function mcpConfigIsStdio(config: Record<string, unknown>): boolean {
  const type = typeof config.type === "string" ? config.type.toLowerCase() : "";
  if (config.command || type === "local" || type === "stdio") return true;
  return false;
}

/**
 * Saved config → form state (reverse mapping). Used by the agent-side form
 * (whose config IS readable) and by tests. The workspace library is
 * write-only, so its form seeds from the summary `transport` instead (see
 * `formFromTransport`). Array `command` (old-style) is split into command +
 * args like web's formFromConfig.
 */
export function formFromConfig(config: unknown): McpFormState {
  if (!isRecord(config)) return emptyMcpForm();

  const extras: Record<string, unknown> = { ...config };
  for (const key of MCP_FORM_KEYS) delete extras[key];

  let command = "";
  let argsText = "";
  if (typeof config.command === "string") command = config.command;
  else if (Array.isArray(config.command)) {
    const tokens = config.command.filter(
      (value): value is string => typeof value === "string",
    );
    command = tokens[0] ?? "";
    argsText = joinArgs(tokens.slice(1));
  }
  if (Array.isArray(config.args)) argsText = joinArgs(config.args);

  const env = pairsFromRecord(config.env ?? config.environment);
  const headers = pairsFromRecord(config.headers);

  return {
    transport: mcpConfigIsStdio(config) ? "stdio" : "http",
    command,
    argsText,
    env,
    url: typeof config.url === "string" ? config.url : "",
    headers,
    extras,
  };
}

/** Seed an empty form from just the summary transport (write-only entries). */
export function formFromTransport(transport: string): McpFormState {
  return {
    ...emptyMcpForm(),
    transport: transport === "stdio" ? "stdio" : "http",
  };
}

// ---------------------------------------------------------------------------
// Form vs JSON editor — web's `EditorMode` contract
// ---------------------------------------------------------------------------

/**
 * The `type` values `configFromForm` can write back without changing them.
 *
 * Deliberately not derived from `mcpTransport`: that is a lossy DISPLAY
 * classifier — it reports "http" for any entry carrying a `url`, whatever its
 * `type` — so `{"type":"websocket","url":"wss://…"}` would look form-editable
 * and be rewritten to `type: "http"` on save. A safety decision needs the
 * explicit value, not the display bucket.
 */
const MCP_FORM_EXPRESSIBLE_TYPES = new Set([
  "local",
  "stdio",
  "remote",
  "http",
  "streamable-http",
]);

/**
 * Whether the guided form can round-trip a SAVED entry without changing it.
 * With no explicit `type` the form infers stdio from `command` and http from
 * `url`, and writes that same shape back; with neither there is nothing for it
 * to express, so the entry is left to the JSON editor.
 */
export function formCanExpressConfig(config: Record<string, unknown>): boolean {
  const type =
    typeof config.type === "string" ? config.type.trim().toLowerCase() : "";
  if (type !== "") return MCP_FORM_EXPRESSIBLE_TYPES.has(type);
  return config.command !== undefined || config.url !== undefined;
}

/** The identifying shape of an entry an editor has to open for. */
export interface McpEditorTarget {
  /** Server-driven summary transport (stdio/http/sse/unknown). */
  transport: string;
  /** Agent-owned entries only: which document container it lives in. */
  container?: McpConfigContainer;
  /** Agent-owned entries only: the saved config, which IS readable. */
  config?: Record<string, unknown>;
}

/**
 * Whether the guided form can edit this entry without changing it. The legacy
 * `mcp` container is provider-native and must round-trip verbatim; so is any
 * entry whose transport the form cannot express. When the caller could not
 * read the saved config back (the workspace library is write-only), the
 * summary transport is the only signal available.
 */
export function formSupportsServer(server: McpEditorTarget): boolean {
  if (server.container === "mcp") return false;
  const config = server.config;
  return config && Object.keys(config).length > 0
    ? formCanExpressConfig(config)
    : formCanExpressTransport(server.transport);
}

/** The editor an entry opens in: the JSON one exactly when the form cannot
 *  represent it. Mirrors web's `setMode(server && !formSupportsServer(server)
 *  ? "json" : "form")`. */
export function editorModeForServer(server: McpEditorTarget | null): McpEditorMode {
  return server && !formSupportsServer(server) ? "json" : "form";
}

export type McpJsonParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; error: string };

/**
 * Parse the JSON editor's text into a config, with web's three-way contract:
 * a JSON syntax error carries the parser's own message, `not_object` means the
 * top level parsed but is not an object, and `missing_target` means the object
 * has neither a `command` nor a `url` — an entry the daemon could not start.
 */
export function parseServerJson(text: string): McpJsonParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : "invalid JSON",
    };
  }
  if (!isRecord(value)) return { ok: false, error: "not_object" };
  if (!value.command && !value.url) return { ok: false, error: "missing_target" };
  return { ok: true, value };
}

// ---------------------------------------------------------------------------
// Editor state machine — shared by both MCP forms so the two cannot diverge
// ---------------------------------------------------------------------------
//
// The workspace-library form and the agent-side form present the same editor
// (name + form/JSON tabs + save). Their chrome differs — a push screen versus
// a modal — but the state transitions below do not, so they live here rather
// than being written twice.

/** The entry an editor opens for. `config`/`container` are present only where
 *  the caller can read the saved config back (agent-owned entries). */
export interface McpEditorServer {
  name: string;
  transport: string;
  container?: McpConfigContainer;
  config?: Record<string, unknown>;
}

export interface McpEditorSeed {
  name: string;
  form: McpFormState;
  jsonText: string;
  mode: McpEditorMode;
}

/**
 * Everything the editor opens with, for a new entry (`null`) or an existing
 * one. A caller that cannot read the saved config back (the write-only
 * workspace library) passes an entry with no `config`: seeding the form from
 * `formFromConfig({})` would open an http form for a known stdio server, so
 * the summary transport is used instead, and the JSON tab starts empty.
 */
export function mcpEditorSeed(server: McpEditorServer | null): McpEditorSeed {
  const config = server?.config ?? {};
  const hasConfig = Object.keys(config).length > 0;
  return {
    name: server?.name ?? "",
    form: !server
      ? emptyMcpForm()
      : hasConfig
        ? formFromConfig(config)
        : formFromTransport(server.transport),
    jsonText: JSON.stringify(config, null, 2),
    mode: editorModeForServer(server),
  };
}

/**
 * Switch editor tabs, carrying the work across. Going to JSON renders the
 * form's current config; coming back parses the JSON. A JSON buffer that does
 * not parse leaves the form untouched — the form tab is disabled in that
 * situation anyway, so this is the guard rather than the path.
 */
export function switchMcpEditorMode({
  to,
  mode,
  form,
  jsonText,
  jsonResult,
}: {
  to: McpEditorMode;
  mode: McpEditorMode;
  form: McpFormState;
  jsonText: string;
  jsonResult: McpJsonParseResult;
}): { mode: McpEditorMode; form: McpFormState; jsonText: string } {
  if (to === "json" && mode === "form") {
    return {
      mode: to,
      form,
      jsonText: JSON.stringify(configFromForm(form), null, 2),
    };
  }
  if (to === "form" && mode === "json" && jsonResult.ok) {
    return { mode: to, form: formFromConfig(jsonResult.value), jsonText };
  }
  return { mode: to, form, jsonText };
}

/** The config a save would write, or `null` when the editor is not valid. */
export function mcpEditorConfig(
  mode: McpEditorMode,
  form: McpFormState,
  jsonResult: McpJsonParseResult,
): Record<string, unknown> | null {
  if (mode === "form") return configFromForm(form);
  return jsonResult.ok ? jsonResult.value : null;
}

export type McpNameError = "required" | "format" | "duplicate" | null;

const MCP_NAME_PATTERN = /^[A-Za-z0-9_-]+$/;

/** Name validation, in web's precedence order. `originalName` is the entry
 *  being edited, whose own name is never a duplicate. */
export function mcpNameError(
  name: string,
  existingNames: readonly string[],
  originalName?: string,
): McpNameError {
  const trimmed = name.trim();
  if (trimmed === "") return "required";
  if (!MCP_NAME_PATTERN.test(trimmed)) return "format";
  if (existingNames.some((n) => n === trimmed && n !== originalName))
    return "duplicate";
  return null;
}

/** The form's own required field, per transport. */
export function mcpFormError(form: McpFormState): "command" | "url" | null {
  if (form.transport === "stdio") {
    return form.command.trim() === "" ? "command" : null;
  }
  return form.url.trim() === "" ? "url" : null;
}

// ---------------------------------------------------------------------------
// Agent-owned `mcp_config` document model
// ---------------------------------------------------------------------------
//
// Unlike the workspace library (write-only), an agent's own MCP config IS
// readable — `Agent.mcp_config` is the raw JSON document the daemon consumes.
// Web parses it with packages/views/agents/components/tabs/mcp-config-model.ts;
// this is the mobile port, kept verbatim so both clients write the same shape.
//
// The document may carry its servers under either `mcpServers` (the common
// shape) or `mcp` (older/newer backends). Both are read; a NEW entry always
// lands in `mcpServers` (web's `upsertManagedMcpServer` default) and an edit
// keeps whichever container the entry already lived in, so a save never
// silently migrates a document.

export type McpConfigContainer = "mcpServers" | "mcp";

export interface ManagedMcpServer {
  name: string;
  config: Record<string, unknown>;
  container: McpConfigContainer;
  transport: string;
  enabled: boolean;
}

const MCP_CONTAINERS: readonly McpConfigContainer[] = ["mcpServers", "mcp"];

/**
 * Display classifier for a raw config — NOT the authoritative `config.type`.
 * stdio wins on a `command` (or an explicit local/stdio type); then sse; then
 * anything url-shaped; everything else is unknown (web `mcpTransport`).
 */
export function mcpTransport(config: Record<string, unknown>): string {
  const type = typeof config.type === "string" ? config.type.toLowerCase() : "";
  if (config.command || type === "local" || type === "stdio") return "stdio";
  if (type === "sse") return "sse";
  if (
    config.url ||
    type === "remote" ||
    type === "http" ||
    type === "streamable-http"
  ) {
    return "http";
  }
  return "unknown";
}

/**
 * Every server in an `mcp_config` document, sorted by name. `mcpServers` wins
 * a name collision with `mcp` — same precedence the daemon applies.
 */
export function listManagedMcpServers(value: unknown): ManagedMcpServer[] {
  if (!isRecord(value)) return [];

  const out: ManagedMcpServer[] = [];
  const seen = new Set<string>();
  for (const container of MCP_CONTAINERS) {
    const raw = value[container];
    if (!isRecord(raw)) continue;
    for (const [name, entry] of Object.entries(raw)) {
      if (seen.has(name) || !isRecord(entry)) continue;
      seen.add(name);
      out.push({
        name,
        config: entry,
        container,
        transport: mcpTransport(entry),
        enabled: entry.enabled !== false && entry.disabled !== true,
      });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Insert or replace one server, returning a NEW document. Editing keeps the
 * entry's existing container and drops the previous name, so a rename moves
 * the entry instead of leaving the old one behind.
 */
export function upsertManagedMcpServer(
  value: unknown,
  previous: ManagedMcpServer | null,
  name: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const document = isRecord(value) ? { ...value } : {};
  const container: McpConfigContainer = previous?.container ?? "mcpServers";

  if (previous) {
    const previousMap = isRecord(document[previous.container])
      ? { ...(document[previous.container] as Record<string, unknown>) }
      : {};
    delete previousMap[previous.name];
    document[previous.container] = previousMap;
  }

  const target = isRecord(document[container])
    ? { ...(document[container] as Record<string, unknown>) }
    : {};
  target[name] = config;
  document[container] = target;
  return document;
}

/**
 * Drop one server. Returns `null` when the document is left empty — that is
 * the "clear the column" sentinel the API's tri-state `mcp_config` expects,
 * so an agent whose last server is deleted goes back to "no config at all"
 * rather than keeping an empty `{ mcpServers: {} }` shell.
 */
export function removeManagedMcpServer(
  value: unknown,
  server: ManagedMcpServer,
): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const document = { ...value };
  const container = isRecord(document[server.container])
    ? { ...(document[server.container] as Record<string, unknown>) }
    : {};
  delete container[server.name];

  if (Object.keys(container).length > 0) document[server.container] = container;
  else delete document[server.container];

  return Object.keys(document).length > 0 ? document : null;
}

/**
 * Names the agent's effective MCP set already covers. The daemon merges
 * runtime < (workspace assignments + the agent's own), so a runtime server
 * with one of these names is shadowed. A DISABLED assignment shadows
 * nothing — mirrors web's `effectiveNames`.
 */
export function managedMcpEffectiveNames(
  managed: readonly ManagedMcpServer[],
  assigned: readonly { name: string; enabled?: boolean }[],
): Set<string> {
  const names = new Set(managed.map((server) => server.name));
  for (const server of assigned) {
    if (server.enabled !== false) names.add(server.name);
  }
  return names;
}