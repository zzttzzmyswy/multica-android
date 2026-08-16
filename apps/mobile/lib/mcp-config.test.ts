import { describe, expect, it } from "vitest";
import {
  configFromForm,
  emptyMcpForm,
  formCanExpressTransport,
  formFromConfig,
  formFromTransport,
  splitArgsText,
  transportLabel,
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