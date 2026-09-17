import { describe, expect, it } from "vitest";
import {
  configFromForm,
  emptyMcpForm,
  formCanExpressTransport,
  formFromConfig,
  formFromTransport,
  listManagedMcpServers,
  managedMcpEffectiveNames,
  mcpTransport,
  removeManagedMcpServer,
  splitArgsText,
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
