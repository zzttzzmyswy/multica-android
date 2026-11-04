/**
 * Guards the crash-survivable boot diagnostics (MYS-2582).
 *
 * The bug being guarded: 0.6.122 "installs, then instantly closes, and there is
 * no log". A release build shows no red box, so every uncaught JS failure is
 * indistinguishable to the user from a native segfault — and unactionable.
 *
 * Two invariants keep that from recurring silently:
 *
 *   1. `prewarmHighlighter()` must not be able to abort module evaluation. It
 *      is an optimisation, it runs at import time in the root layout, and
 *      `createHighlighterCore` can throw synchronously in a way its internal
 *      `.catch()` cannot intercept.
 *   2. The global error handler must always delegate to the previous handler.
 *      Capturing errors by swallowing them would blind every other consumer
 *      (RN's own fatal path included) — a diagnostics feature that hides
 *      crashes is worse than none.
 *
 * The file-writing helpers are exercised against a fake `expo-file-system`
 * because mobile's vitest lane is Node-only (see vitest.config.ts) and the real
 * module requires a native host.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const APP_ROOT = path.resolve(__dirname, "..");

/** Minimal in-memory stand-in for expo-file-system's File/Directory API. */
const fakeFs = vi.hoisted(() => {
  const files = new Map<string, string>();
  class FakeFile {
    constructor(
      public dir: unknown,
      public name: string,
    ) {}
    get exists() {
      return files.has(this.name);
    }
    write(contents: string) {
      files.set(this.name, contents);
    }
    textSync() {
      const v = files.get(this.name);
      if (v === undefined) throw new Error("ENOENT");
      return v;
    }
    delete() {
      files.delete(this.name);
    }
  }
  return { files, FakeFile };
});

vi.mock("expo-file-system", () => ({
  File: fakeFs.FakeFile,
  Directory: class {},
  Paths: { document: {}, cache: {} },
}));

import {
  markBootComplete,
  markBootStep,
  readCurrentBootStep,
  readPreviousBootFailure,
} from "./boot-diagnostics";
import {
  __resetGlobalErrorCaptureForTests,
  installGlobalErrorCapture,
  setCapturedErrorListener,
  type CapturedError,
} from "./global-error-capture";

beforeEach(() => {
  fakeFs.files.clear();
  __resetGlobalErrorCaptureForTests();
});

afterEach(() => {
  delete (globalThis as { ErrorUtils?: unknown }).ErrorUtils;
});

describe("boot breadcrumbs", () => {
  it("reports the step a previous boot died in", () => {
    markBootStep("root-layout:prewarm-highlighter");
    // Simulate: process dies here. Next cold start reads the marker.
    expect(readPreviousBootFailure()).toBe("root-layout:prewarm-highlighter");
  });

  it("reports nothing once a boot completes", () => {
    markBootStep("root-layout:module-eval");
    markBootComplete();
    expect(readPreviousBootFailure()).toBeNull();
  });

  it("never throws when the filesystem is unavailable", () => {
    // A diagnostics helper that can itself crash the app is worse than none.
    const broken = vi.spyOn(fakeFs.FakeFile.prototype, "write").mockImplementation(() => {
      throw new Error("EROFS");
    });
    expect(() => markBootStep("x")).not.toThrow();
    broken.mockRestore();
  });

  it("tracks the current process step in memory", () => {
    markBootStep("a");
    expect(readCurrentBootStep()).toBe("a");
    markBootStep("b");
    expect(readCurrentBootStep()).toBe("b");
  });
});

describe("global error capture", () => {
  function installFakeErrorUtils() {
    const previous = vi.fn();
    const handlers: ((e: unknown, fatal?: boolean) => void)[] = [];
    (globalThis as { ErrorUtils?: unknown }).ErrorUtils = {
      getGlobalHandler: () => previous,
      setGlobalHandler: (fn: (e: unknown, fatal?: boolean) => void) => {
        handlers.push(fn);
      },
    };
    return { previous, handlers };
  }

  it("records the error and annotates it with the boot step", () => {
    const { handlers } = installFakeErrorUtils();
    installGlobalErrorCapture();
    markBootStep("root-layout:prewarm-highlighter");

    const seen: CapturedError[] = [];
    setCapturedErrorListener((e) => seen.push(e));

    handlers[0](new Error("boom"), true);

    expect(seen).toHaveLength(1);
    expect(seen[0].message).toBe("boom");
    expect(seen[0].isFatal).toBe(true);
    expect(seen[0].bootStep).toBe("root-layout:prewarm-highlighter");
  });

  it("ALWAYS delegates to the previous handler", () => {
    // Swallowing would hide the crash from RN's own fatal path and from any
    // other reporter — the opposite of the point of this module.
    const { previous, handlers } = installFakeErrorUtils();
    installGlobalErrorCapture();

    const err = new Error("boom");
    handlers[0](err, true);

    expect(previous).toHaveBeenCalledWith(err, true);
  });

  it("survives a listener that throws", () => {
    const { previous, handlers } = installFakeErrorUtils();
    installGlobalErrorCapture();
    setCapturedErrorListener(() => {
      throw new Error("listener exploded");
    });

    expect(() => handlers[0](new Error("boom"), true)).not.toThrow();
    expect(previous).toHaveBeenCalled();
  });

  it("installs only once even if the layout remounts", () => {
    const { handlers } = installFakeErrorUtils();
    installGlobalErrorCapture();
    installGlobalErrorCapture();
    installGlobalErrorCapture();
    expect(handlers).toHaveLength(1);
  });

  it("does nothing (and does not throw) without ErrorUtils", () => {
    expect(() => installGlobalErrorCapture()).not.toThrow();
  });
});

describe("module-eval safety on the boot path", () => {
  it("wraps the highlighter prewarm so it cannot abort the entry module", () => {
    // The 0.6.122 shape: an uncaught throw here kills the bundle while the
    // splash is up, which reads to the user as "it just closes".
    const src = readFileSync(path.join(APP_ROOT, "app/_layout.tsx"), "utf8");
    const idx = src.indexOf("prewarmHighlighter()");
    expect(idx).toBeGreaterThan(-1);

    // It must sit inside a try block, and that try must be the guarded one —
    // assert the surrounding window rather than the whole file, so an
    // unrelated try elsewhere cannot satisfy this.
    const window = src.slice(Math.max(0, idx - 400), idx + 200);
    expect(window).toMatch(/try\s*\{[^}]*prewarmHighlighter\(\)/s);
    expect(window).toMatch(/catch\s*\(/);
  });

  it("mounts the fatal-error boundary as the outermost element", () => {
    const src = readFileSync(path.join(APP_ROOT, "app/_layout.tsx"), "utf8");
    const ret = src.slice(src.indexOf("export default function RootLayout"));
    // Nothing may wrap the boundary: an error in a parent would escape it.
    expect(ret).toMatch(/return \(\s*<FatalErrorBoundary>/);
  });
});
