/**
 * Client identity headers — the fix for the fork reporting every Android
 * install as iOS on version 0.6.5.
 *
 * The server records these per request and reads them as analytics / feedback
 * metadata, so a wrong value is not cosmetic: it corrupts the platform
 * breakdown and the version dimension used to scope bug reports. That is why
 * "unknown" is asserted here as the degradation target rather than any
 * plausible-looking default.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CLIENT_PLATFORM,
  UNKNOWN_CLIENT_OS,
  UNKNOWN_CLIENT_VERSION,
  clientIdentityHeaders,
  resolveClientOs,
  resolveClientVersion,
} from "./client-identity";

describe("resolveClientOs", () => {
  it("passes the real platform through", () => {
    expect(resolveClientOs({ os: "android" })).toBe("android");
    expect(resolveClientOs({ os: "ios" })).toBe("ios");
  });

  it("reports unknown rather than guessing a platform", () => {
    // A wrong platform silently corrupts the breakdown; "unknown" is
    // reportable and honestly a gap.
    expect(resolveClientOs({})).toBe(UNKNOWN_CLIENT_OS);
    expect(resolveClientOs({ os: null })).toBe(UNKNOWN_CLIENT_OS);
    expect(resolveClientOs({ os: "   " })).toBe(UNKNOWN_CLIENT_OS);
  });

  it("trims stray whitespace", () => {
    expect(resolveClientOs({ os: " android " })).toBe("android");
  });
});

describe("resolveClientVersion", () => {
  it("passes the app version through", () => {
    expect(resolveClientVersion({ version: "0.6.76" })).toBe("0.6.76");
  });

  it("reports unknown rather than a stale literal", () => {
    expect(resolveClientVersion({})).toBe(UNKNOWN_CLIENT_VERSION);
    expect(resolveClientVersion({ version: "" })).toBe(UNKNOWN_CLIENT_VERSION);
  });

  it("is never the version the fork used to send", () => {
    // Pin the regression: 0.6.5 was hard-coded and fell 70 releases behind.
    expect(resolveClientVersion({})).not.toBe("0.6.5");
  });
});

describe("clientIdentityHeaders", () => {
  it("builds all three headers from the source", () => {
    expect(clientIdentityHeaders({ os: "android", version: "0.6.76" })).toEqual({
      "X-Client-Platform": "mobile",
      "X-Client-OS": "android",
      "X-Client-Version": "0.6.76",
    });
  });

  it("keeps the platform token fixed — it is not Platform.OS", () => {
    // The server has a distinct token for the mobile app as opposed to the web
    // and desktop clients, so this must not track the device OS.
    expect(CLIENT_PLATFORM).toBe("mobile");
    expect(clientIdentityHeaders({ os: "ios" })["X-Client-Platform"]).toBe("mobile");
  });

  it("degraded values are still well-formed headers", () => {
    const headers = clientIdentityHeaders({});
    expect(headers["X-Client-OS"]).toBe(UNKNOWN_CLIENT_OS);
    expect(headers["X-Client-Version"]).toBe(UNKNOWN_CLIENT_VERSION);
  });
});

// ---------------------------------------------------------------------------
// The WebSocket carries the same identity as the HTTP layer
// ---------------------------------------------------------------------------

describe("realtime identity", () => {
  // The socket URL query is the third place client identity is declared (after
  // the JSON transport and the multipart upload). It was hard-coded to `ios`
  // and given the package version ("0.1.0") rather than the app version, so the
  // server's socket logs carried the same two wrong values the headers did.
  const ws = readFileSync(
    path.join(__dirname, "..", "data", "realtime", "ws-client.ts"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const provider = readFileSync(
    path.join(__dirname, "..", "data", "realtime", "realtime-provider.tsx"),
    "utf8",
  ).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("no longer hard-codes ios in the socket URL", () => {
    expect(ws).not.toContain('"client_os", "ios"');
    expect(ws).toContain('"client_os", this.opts.os ?? UNKNOWN_CLIENT_OS');
  });

  it("reuses the shared platform token and version fallback", () => {
    expect(ws).toContain('"client_platform", CLIENT_PLATFORM');
    expect(ws).toContain("UNKNOWN_CLIENT_VERSION");
  });

  it("always sends a version, so the server never sees it absent", () => {
    expect(ws).not.toMatch(/if \(this\.opts\.clientVersion\) \{\s*\n\s*url\.searchParams\.set\("client_version"/);
  });

  it("resolves the real app version and platform at the provider", () => {
    expect(provider).toMatch(/clientVersion: resolveAppVersion\(Constants\)/);
    expect(provider).toMatch(/os: Platform\.OS/);
    expect(provider).not.toContain('clientVersion: "0.1.0"');
  });
});
