import { describe, expect, it } from "vitest";
import {
  configFromForm,
  editorModeForServer,
  emptyMcpForm,
  formCanExpressConfig,
  formCanExpressTransport,
  formFromConfig,
  formFromTransport,
  formSupportsServer,
  listManagedMcpServers,
  managedMcpEffectiveNames,
  mcpEditorConfig,
  mcpEditorSeed,
  mcpFormError,
  mcpNameError,
  mcpTransport,
  parseServerJson,
  removeManagedMcpServer,
  splitArgsText,
  switchMcpEditorMode,
  transportLabel,
  upsertManagedMcpServer,
  type McpFormState,
} from "./mcp-config";

describe("transportLabel", () => {
  it("labels known transports and passes unknown ones through", () => {
    expect(transportLabel("stdio")).toBe("stdio");
    expect(transportLabel("http")).toBe("HTTP");
    expect(transportLabel("sse")).toBe("SSE");
    expect(transportLabel("ws")).toBe("ws");
    expect(transportLabel("")).toBe("unknown");
    expect(transportLabel(undefined)).toBe("unknown");
    expect(transportLabel(null)).toBe("unknown");
  });
});

describe("formCanExpressTransport", () => {
  it("only the two form transports are expressible", () => {
    expect(formCanExpressTransport("stdio")).toBe(true);
    expect(formCanExpressTransport("http")).toBe(true);
    expect(formCanExpressTransport("sse")).toBe(false);
    expect(formCanExpressTransport("unknown")).toBe(false);
  });
});

describe("splitArgsText", () => {
  it("splits on whitespace and drops empties", () => {
    expect(splitArgsText("--port 3000 --verbose")).toEqual([
      "--port",
      "3000",
      "--verbose",
    ]);
    expect(splitArgsText("   ")).toEqual([]);
    expect(splitArgsText("  npx  ")).toEqual(["npx"]);
  });
});

describe("configFromForm", () => {
  it("emits a stdio config with command + optional args/env", () => {
    const form: McpFormState = {
      ...emptyMcpForm(),
      transport: "stdio",
      command: " npx ",
      argsText: "--config mcp.json",
      env: [
        { key: "API_KEY", value: "secret" },
        { key: "", value: "dropped" },
      ],
    };
    expect(configFromForm(form)).toEqual({
      command: "npx",
      args: ["--config", "mcp.json"],
      env: { API_KEY: "secret" },
    });
  });

  it("omits empty args/env from a bare command config", () => {
    expect(configFromForm(emptyMcpForm())).toEqual({ command: "" });
  });

  it("emits an http config with type/url + optional headers", () => {
    const form: McpFormState = {
      ...emptyMcpForm(),
      transport: "http",
      url: " https://mcp.example.com/mcp ",
      headers: [
        { key: "Authorization", value: "Bearer x" },
        { key: "", value: "y" },
      ],
    };
    expect(configFromForm(form)).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
  });

  it("does not emit headers when none are filled", () => {
    const form: McpFormState = {
      ...emptyMcpForm(),
      transport: "http",
      url: "https://mcp.example.com/mcp",
    };
    expect(configFromForm(form)).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
    });
  });
});

describe("formFromConfig (round-trip for expressible configs)", () => {
  it("maps a stdio config back to the form", () => {
    const form = formFromConfig({
      command: "npx",
      args: ["--config", "mcp.json"],
      env: { API_KEY: "secret" },
    });
    expect(form.transport).toBe("stdio");
    expect(form.command).toBe("npx");
    expect(form.argsText).toBe("--config mcp.json");
    expect(form.env).toEqual([{ key: "API_KEY", value: "secret" }]);
  });

  it("maps an http config back including headers", () => {
    const form = formFromConfig({
      type: "http",
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: "Bearer x" },
    });
    expect(form.transport).toBe("http");
    expect(form.url).toBe("https://mcp.example.com/mcp");
    expect(form.headers).toEqual([{ key: "Authorization", value: "Bearer x" }]);
  });

  it("splits an array-command stdio entry into command + args", () => {
    const form = formFromConfig({
      command: ["npx", "-y", "@modelcontextprotocol/server-filesystem"],
    });
    expect(form.transport).toBe("stdio");
    expect(form.command).toBe("npx");
    expect(form.argsText).toBe("-y @modelcontextprotocol/server-filesystem");
  });

  it("round-trips form → config → form for both transports", () => {
    for (const transport of ["stdio", "http"] as const) {
      const original: McpFormState =
        transport === "stdio"
          ? {
              ...emptyMcpForm(),
              transport,
              command: "npx",
              argsText: "--x 1",
              env: [{ key: "K", value: "V" }],
            }
          : {
              ...emptyMcpForm(),
              transport,
              url: "https://mcp.example.com/mcp",
              headers: [{ key: "H", value: "1" }],
            };
      expect(formFromConfig(configFromForm(original))).toEqual(original);
    }
  });
});

describe("formFromTransport", () => {
  it("seeds an empty form on the summary transport (write-only entries)", () => {
    expect(formFromTransport("stdio").transport).toBe("stdio");
    expect(formFromTransport("http").transport).toBe("http");
    // unknown summary → http form (never silently rewrites stdio; safe because
    // unknown entries are not form-editable anyway)
    expect(formFromTransport("sse").transport).toBe("http");
  });
});
describe("mcpTransport", () => {
  it("classifies stdio on a command or an explicit local type", () => {
    expect(mcpTransport({ command: "npx" })).toBe("stdio");
    expect(mcpTransport({ type: "stdio" })).toBe("stdio");
    expect(mcpTransport({ type: "LOCAL" })).toBe("stdio");
  });

  it("classifies sse before the url-shaped fallbacks", () => {
    expect(mcpTransport({ type: "sse", url: "https://x" })).toBe("sse");
  });

  it("classifies http from a url or a remote-family type", () => {
    expect(mcpTransport({ url: "https://x" })).toBe("http");
    expect(mcpTransport({ type: "remote" })).toBe("http");
    expect(mcpTransport({ type: "http" })).toBe("http");
    expect(mcpTransport({ type: "streamable-http" })).toBe("http");
  });

  it("falls back to unknown for anything else", () => {
    expect(mcpTransport({})).toBe("unknown");
    expect(mcpTransport({ type: "carrier-pigeon" })).toBe("unknown");
  });
});

describe("listManagedMcpServers", () => {
  it("reads both containers, mcpServers winning a name collision", () => {
    const servers = listManagedMcpServers({
      mcpServers: { alpha: { command: "a" }, beta: { command: "b" } },
      mcp: { beta: { command: "shadowed" }, gamma: { url: "https://g" } },
    });
    expect(servers.map((s) => s.name)).toEqual(["alpha", "beta", "gamma"]);
    expect(servers.find((s) => s.name === "beta")?.container).toBe("mcpServers");
    expect(servers.find((s) => s.name === "gamma")?.container).toBe("mcp");
  });

  it("sorts by name and reports transport + container", () => {
    const servers = listManagedMcpServers({
      mcp: { zed: { command: "z" }, abc: { url: "https://a" } },
    });
    expect(servers.map((s) => [s.name, s.transport, s.container])).toEqual([
      ["abc", "http", "mcp"],
      ["zed", "stdio", "mcp"],
    ]);
  });

  it("treats enabled/disabled flags with the daemon's precedence", () => {
    const servers = listManagedMcpServers({
      mcpServers: {
        on: { command: "a", enabled: true },
        off: { command: "b", enabled: false },
        legacyOff: { command: "c", disabled: true },
        legacyOn: { command: "d", disabled: false },
      },
    });
    const byName = Object.fromEntries(servers.map((s) => [s.name, s.enabled]));
    expect(byName).toEqual({
      on: true,
      off: false,
      legacyOff: false,
      legacyOn: true,
    });
  });

  it("degrades a non-document to no servers", () => {
    expect(listManagedMcpServers(null)).toEqual([]);
    expect(listManagedMcpServers("nope")).toEqual([]);
    expect(listManagedMcpServers({ mcpServers: "nope" })).toEqual([]);
  });
});

describe("upsertManagedMcpServer", () => {
  it("creates the container on a first add", () => {
    expect(
      upsertManagedMcpServer(null, null, "srv", { command: "npx" }),
    ).toEqual({ mcpServers: { srv: { command: "npx" } } });
  });

  it("keeps unrelated document keys and other servers", () => {
    const next = upsertManagedMcpServer(
      { other: 1, mcpServers: { keep: { command: "k" } } },
      null,
      "new",
      { command: "n" },
    );
    expect(next).toEqual({
      other: 1,
      mcpServers: { keep: { command: "k" }, new: { command: "n" } },
    });
  });

  it("renames in place, dropping the previous name and keeping the container", () => {
    const previous = {
      name: "old",
      config: { command: "o" },
      container: "mcp" as const,
      transport: "stdio",
      enabled: true,
    };
    const next = upsertManagedMcpServer(
      { mcp: { old: { command: "o" }, keep: { command: "k" } } },
      previous,
      "fresh",
      { command: "f" },
    );
    expect(next).toEqual({
      mcp: { keep: { command: "k" }, fresh: { command: "f" } },
    });
  });

  it("replaces an edited server's config without touching its neighbours", () => {
    const previous = {
      name: "srv",
      config: { command: "old" },
      container: "mcpServers" as const,
      transport: "stdio",
      enabled: true,
    };
    const next = upsertManagedMcpServer(
      { mcpServers: { srv: { command: "old" }, other: { command: "o" } } },
      previous,
      "srv",
      { command: "new" },
    );
    expect(next).toEqual({
      mcpServers: { other: { command: "o" }, srv: { command: "new" } },
    });
  });

  it("does not mutate the input document", () => {
    const input = { mcpServers: { a: { command: "a" } } };
    upsertManagedMcpServer(input, null, "b", { command: "b" });
    expect(input).toEqual({ mcpServers: { a: { command: "a" } } });
  });
});

describe("removeManagedMcpServer", () => {
  const server = {
    name: "srv",
    config: { command: "x" },
    container: "mcpServers" as const,
    transport: "stdio",
    enabled: true,
  };

  it("drops the entry and keeps the rest", () => {
    expect(
      removeManagedMcpServer(
        { mcpServers: { srv: { command: "x" }, keep: { command: "k" } } },
        server,
      ),
    ).toEqual({ mcpServers: { keep: { command: "k" } } });
  });

  it("returns null when the document is left empty — the API's clear sentinel", () => {
    expect(removeManagedMcpServer({ mcpServers: { srv: {} } }, server)).toBeNull();
  });

  it("drops the container but keeps sibling keys in the document", () => {
    expect(
      removeManagedMcpServer({ mcpServers: { srv: {} }, other: 1 }, server),
    ).toEqual({ other: 1 });
  });

  it("returns null for a non-document", () => {
    expect(removeManagedMcpServer(null, server)).toBeNull();
  });
});

describe("managedMcpEffectiveNames", () => {
  it("unions the agent's own names with its enabled assignments", () => {
    const names = managedMcpEffectiveNames(
      [
        {
          name: "own",
          config: {},
          container: "mcpServers",
          transport: "stdio",
          enabled: true,
        },
      ],
      [
        { name: "assigned", enabled: true },
        { name: "disabled", enabled: false },
        { name: "defaulted" },
      ],
    );
    expect([...names].sort()).toEqual(["assigned", "defaulted", "own"]);
  });
});

// ---------------------------------------------------------------------------
// Form vs JSON editor (web `EditorMode` parity)
// ---------------------------------------------------------------------------

describe("parseServerJson", () => {
  it("accepts an object carrying a command or a url", () => {
    expect(parseServerJson('{"command":"npx"}')).toEqual({
      ok: true,
      value: { command: "npx" },
    });
    expect(parseServerJson('{"url":"https://x"}')).toEqual({
      ok: true,
      value: { url: "https://x" },
    });
  });

  it("reports a syntax error with the parser's own message", () => {
    const result = parseServerJson("{ nope");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).not.toBe("not_object");
      expect(result.error).not.toBe("missing_target");
      expect(result.error.length).toBeGreaterThan(0);
    }
  });

  it("distinguishes a non-object top level from a missing target", () => {
    expect(parseServerJson("[1,2]")).toEqual({ ok: false, error: "not_object" });
    expect(parseServerJson('"npx"')).toEqual({ ok: false, error: "not_object" });
    expect(parseServerJson("null")).toEqual({ ok: false, error: "not_object" });
    expect(parseServerJson("{}")).toEqual({
      ok: false,
      error: "missing_target",
    });
    expect(parseServerJson('{"type":"sse"}')).toEqual({
      ok: false,
      error: "missing_target",
    });
  });
});

describe("formCanExpressConfig", () => {
  it("accepts the types configFromForm writes back unchanged", () => {
    for (const type of ["local", "stdio", "remote", "http", "streamable-http"]) {
      expect(formCanExpressConfig({ type, url: "https://x" })).toBe(true);
    }
    expect(formCanExpressConfig({ type: "HTTP", url: "https://x" })).toBe(true);
  });

  it("refuses a type the form would rewrite — a url does not make it http", () => {
    expect(formCanExpressConfig({ type: "websocket", url: "wss://x" })).toBe(
      false,
    );
    expect(formCanExpressConfig({ type: "sse", url: "https://x" })).toBe(false);
  });

  it("infers from the fields when no explicit type is present", () => {
    expect(formCanExpressConfig({ command: "npx" })).toBe(true);
    expect(formCanExpressConfig({ url: "https://x" })).toBe(true);
    expect(formCanExpressConfig({})).toBe(false);
    expect(formCanExpressConfig({ note: "nothing to express" })).toBe(false);
  });
});

describe("formSupportsServer / editorModeForServer", () => {
  it("never routes the legacy native container through the form", () => {
    const server = {
      name: "legacy",
      transport: "stdio",
      container: "mcp" as const,
      config: { command: "npx" },
    };
    expect(formSupportsServer(server)).toBe(false);
    expect(editorModeForServer(server)).toBe("json");
  });

  it("judges a readable config by the config, not the summary transport", () => {
    // The summary says stdio; the entry itself says otherwise.
    expect(
      formSupportsServer({
        transport: "stdio",
        container: "mcpServers",
        config: { type: "websocket", url: "wss://x" },
      }),
    ).toBe(false);
  });

  it("falls back to the summary transport when the config is unreadable", () => {
    expect(formSupportsServer({ transport: "stdio" })).toBe(true);
    expect(formSupportsServer({ transport: "http" })).toBe(true);
    expect(formSupportsServer({ transport: "sse" })).toBe(false);
    expect(formSupportsServer({ transport: "unknown" })).toBe(false);
  });

  it("opens a new entry on the form", () => {
    expect(editorModeForServer(null)).toBe("form");
  });
});

describe("mcpEditorSeed", () => {
  it("seeds a blank form for a new entry", () => {
    const seed = mcpEditorSeed(null);
    expect(seed).toEqual({
      name: "",
      form: emptyMcpForm(),
      jsonText: "{}",
      mode: "form",
    });
  });

  it("seeds an unreadable entry from the summary transport, JSON buffer empty", () => {
    const seed = mcpEditorSeed({ name: "srv", transport: "stdio" });
    expect(seed.form.transport).toBe("stdio");
    expect(seed.jsonText).toBe("{}");
    expect(seed.mode).toBe("form");
  });

  it("seeds a readable entry from its config and opens JSON when the form cannot", () => {
    const seed = mcpEditorSeed({
      name: "sse-srv",
      transport: "sse",
      container: "mcpServers",
      config: { type: "sse", url: "https://x" },
    });
    expect(seed.mode).toBe("json");
    expect(JSON.parse(seed.jsonText)).toEqual({
      type: "sse",
      url: "https://x",
    });
  });
});

describe("switchMcpEditorMode", () => {
  const form: McpFormState = {
    ...emptyMcpForm(),
    transport: "http",
    url: "https://mcp.example.com/mcp",
  };
  const jsonText = '{"type":"http","url":"https://mcp.example.com/mcp"}';

  it("renders the form into the JSON buffer on the way out", () => {
    const next = switchMcpEditorMode({
      to: "json",
      mode: "form",
      form,
      jsonText: "{}",
      jsonResult: { ok: true, value: {} },
    });
    expect(next.mode).toBe("json");
    expect(JSON.parse(next.jsonText)).toEqual({
      type: "http",
      url: "https://mcp.example.com/mcp",
    });
  });

  it("parses the JSON buffer back into the form", () => {
    const next = switchMcpEditorMode({
      to: "form",
      mode: "json",
      form: emptyMcpForm(),
      jsonText,
      jsonResult: { ok: true, value: JSON.parse(jsonText) },
    });
    expect(next.mode).toBe("form");
    expect(next.form.url).toBe("https://mcp.example.com/mcp");
    expect(next.form.transport).toBe("http");
  });

  it("leaves the form alone when the JSON buffer does not parse", () => {
    const next = switchMcpEditorMode({
      to: "form",
      mode: "json",
      form,
      jsonText: "{ nope",
      jsonResult: { ok: false, error: "Unexpected token" },
    });
    expect(next.mode).toBe("form");
    expect(next.form).toBe(form);
  });
});

describe("mcpEditorConfig", () => {
  it("reads the active editor only", () => {
    const form: McpFormState = {
      ...emptyMcpForm(),
      transport: "stdio",
      command: "npx",
    };
    expect(mcpEditorConfig("form", form, { ok: false, error: "x" })).toEqual({
      command: "npx",
    });
    expect(
      mcpEditorConfig("json", form, { ok: true, value: { url: "https://x" } }),
    ).toEqual({ url: "https://x" });
  });

  it("returns null when the JSON editor holds nothing valid", () => {
    expect(
      mcpEditorConfig("json", emptyMcpForm(), { ok: false, error: "x" }),
    ).toBeNull();
  });
});

describe("mcpNameError", () => {
  it("applies web's precedence: required, then format, then duplicate", () => {
    expect(mcpNameError("", [])).toBe("required");
    expect(mcpNameError("   ", [])).toBe("required");
    expect(mcpNameError("has space", [])).toBe("format");
    expect(mcpNameError("ok-1", ["ok-1"])).toBe("duplicate");
    expect(mcpNameError("ok-1", [])).toBeNull();
  });

  it("never treats the entry being edited as its own duplicate", () => {
    expect(mcpNameError("srv", ["srv"], "srv")).toBeNull();
    expect(mcpNameError("srv", ["srv", "other"], "other")).toBe("duplicate");
  });
});

describe("mcpFormError", () => {
  it("requires the field the chosen transport needs", () => {
    expect(mcpFormError(emptyMcpForm())).toBe("command");
    expect(mcpFormError({ ...emptyMcpForm(), command: " npx " })).toBeNull();
    expect(mcpFormError({ ...emptyMcpForm(), transport: "http" })).toBe("url");
    expect(
      mcpFormError({ ...emptyMcpForm(), transport: "http", url: "https://x" }),
    ).toBeNull();
  });
});

describe("extras round-trip", () => {
  it("carries keys the form has no field for through a form save", () => {
    const saved = {
      command: "npx",
      disabled: true,
      timeoutMs: 5000,
      nested: { a: 1 },
    };
    expect(configFromForm(formFromConfig(saved))).toEqual(saved);
  });

  it("re-emits the modelled keys in form shape, as web does", () => {
    // A stdio entry loses an explicit `type` — the daemon infers stdio from
    // `command`, and web's configFromForm writes the same shape. An http-family
    // type is normalised to `http`. This is the documented asymmetry, not a
    // dropped field: `formCanExpressConfig` is what keeps an entry the form
    // would rewrite OUT of the form in the first place.
    expect(
      configFromForm(formFromConfig({ type: "stdio", command: "npx" })),
    ).toEqual({ command: "npx" });
    expect(
      configFromForm(formFromConfig({ type: "remote", url: "https://x" })),
    ).toEqual({ type: "http", url: "https://x" });
  });

  it("keeps extras empty for a form that was never seeded from a config", () => {
    expect(emptyMcpForm().extras).toEqual({});
    expect(formFromTransport("http").extras).toEqual({});
  });
});
