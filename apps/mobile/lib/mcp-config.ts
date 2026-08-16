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