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
 *    not form-editable (the web UI routes them to a JSON editor mobile
 *    doesn't ship — we hide the edit affordance instead).
 */

export type McpFormTransport = "stdio" | "http";
export type McpKeyValue = { key: string; value: string };

export interface McpFormState {
  transport: McpFormTransport;
  command: string;
  /** Space-separated argument tokens (mobile single-field input). */
  argsText: string;
  env: McpKeyValue[];
  url: string;
  headers: McpKeyValue[];
}

export const emptyMcpForm = (): McpFormState => ({
  transport: "stdio",
  command: "",
  argsText: "",
  env: [],
  url: "",
  headers: [],
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
 * `headers`. Config never round-trips, so there is nothing to preserve here.
 */
export function configFromForm(form: McpFormState): Record<string, unknown> {
  const config: Record<string, unknown> = {};
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
 * Saved config → form state (reverse mapping). Used by tests and by the JSON
 * round-trip; the live form is write-only so it seeds from the summary
 * `transport` instead (see `formFromTransport`). Array `command` (old-style)
 * is split into command + args like web's formFromConfig.
 */
export function formFromConfig(config: unknown): McpFormState {
  if (!isRecord(config)) return emptyMcpForm();

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