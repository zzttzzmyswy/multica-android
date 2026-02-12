import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveWorkspaceDir, ensureWorkspaceDir } from "./workspace.js";
import { DATA_DIR, DEFAULT_WORKSPACE_DIR } from "@multica/utils";

describe("resolveWorkspaceDir", () => {
  const originalEnv = process.env.MULTICA_WORKSPACE_DIR;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MULTICA_WORKSPACE_DIR;
    } else {
      process.env.MULTICA_WORKSPACE_DIR = originalEnv;
    }
  });

  it("returns ~/.super-multica/workspace/default for default profile", () => {
    delete process.env.MULTICA_WORKSPACE_DIR;
    expect(resolveWorkspaceDir()).toBe(path.join(DEFAULT_WORKSPACE_DIR, "default"));
    expect(resolveWorkspaceDir({ profileId: "default" })).toBe(path.join(DEFAULT_WORKSPACE_DIR, "default"));
  });

  it("returns ~/.super-multica/workspace/{id} for named profile", () => {
    delete process.env.MULTICA_WORKSPACE_DIR;
    const result = resolveWorkspaceDir({ profileId: "research" });
    expect(result).toBe(path.join(DEFAULT_WORKSPACE_DIR, "research"));
  });

  it("prioritizes MULTICA_WORKSPACE_DIR env var", () => {
    process.env.MULTICA_WORKSPACE_DIR = "/tmp/custom-ws";
    expect(resolveWorkspaceDir({ profileId: "default" })).toBe("/tmp/custom-ws");
  });

  it("prioritizes config workspaceDir over profile default", () => {
    delete process.env.MULTICA_WORKSPACE_DIR;
    const result = resolveWorkspaceDir({
      profileId: "default",
      configWorkspaceDir: "/tmp/config-ws",
    });
    expect(result).toBe("/tmp/config-ws");
  });

  it("env var takes precedence over config", () => {
    process.env.MULTICA_WORKSPACE_DIR = "/tmp/env-ws";
    const result = resolveWorkspaceDir({
      profileId: "default",
      configWorkspaceDir: "/tmp/config-ws",
    });
    expect(result).toBe("/tmp/env-ws");
  });

  it("expands ~ in env var", () => {
    process.env.MULTICA_WORKSPACE_DIR = "~/my-workspace";
    const result = resolveWorkspaceDir();
    expect(result).toBe(path.resolve(path.join(os.homedir(), "my-workspace")));
  });

  it("expands ~ in config workspaceDir", () => {
    delete process.env.MULTICA_WORKSPACE_DIR;
    const result = resolveWorkspaceDir({ configWorkspaceDir: "~/my-ws" });
    expect(result).toBe(path.resolve(path.join(os.homedir(), "my-ws")));
  });
});

describe("ensureWorkspaceDir", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "multica-ws-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates directory and README.md", () => {
    const wsDir = path.join(tmpDir, "workspace");
    ensureWorkspaceDir(wsDir);

    expect(fs.existsSync(wsDir)).toBe(true);
    const readmePath = path.join(wsDir, "README.md");
    expect(fs.existsSync(readmePath)).toBe(true);
    const content = fs.readFileSync(readmePath, "utf-8");
    expect(content).toContain("Multica Workspace");
  });

  it("does not overwrite existing README.md", () => {
    const wsDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(wsDir, { recursive: true });
    const readmePath = path.join(wsDir, "README.md");
    fs.writeFileSync(readmePath, "custom content");

    ensureWorkspaceDir(wsDir);

    const content = fs.readFileSync(readmePath, "utf-8");
    expect(content).toBe("custom content");
  });

  it("succeeds when directory already exists", () => {
    const wsDir = path.join(tmpDir, "workspace");
    fs.mkdirSync(wsDir, { recursive: true });

    expect(() => ensureWorkspaceDir(wsDir)).not.toThrow();
  });
});
