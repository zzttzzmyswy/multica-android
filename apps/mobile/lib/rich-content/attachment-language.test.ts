import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentLanguage } from "./attachment-language";

/**
 * Filename → Shiki language for the inline text-attachment preview.
 *
 * The invariant that matters is not "does `.py` map to python" but "does every
 * answer this returns actually highlight". A mapping to a grammar the app does
 * not bundle renders identically to no mapping at all, while claiming a
 * capability the app lacks — and the app discovers that at runtime by
 * `resolveLang` returning null and falling back to plain monospace.
 *
 * So the guard is written against the real grammar list, read out of
 * `lib/markdown/shiki.ts`. It is read as source rather than imported because
 * that module pulls in `react-native-shiki-engine` (a native module) at module
 * scope, which cannot load in the Node vitest lane — the same reason the
 * action-parity suite is source-level.
 */

const APP_ROOT = path.resolve(__dirname, "..", "..");
const SHIKI = path.join(APP_ROOT, "lib/markdown/shiki.ts");

/** Parsed from `const KNOWN_LANGS: ReadonlySet<string> = new Set([...])`. */
function knownLangs(): Set<string> {
  const src = readFileSync(SHIKI, "utf8");
  const m = src.match(/KNOWN_LANGS[^=]*=\s*new Set\(\[([\s\S]*?)\]\)/);
  if (!m) throw new Error("could not parse KNOWN_LANGS out of shiki.ts");
  return new Set(
    (m[1].match(/"[^"]+"/g) ?? []).map((s) => s.slice(1, -1)),
  );
}

/** Parsed from `const LANG_ALIASES: Record<string, string> = {...}`. */
function langAliases(): Record<string, string> {
  const src = readFileSync(SHIKI, "utf8");
  const m = src.match(/LANG_ALIASES[^=]*=\s*\{([\s\S]*?)\}/);
  if (!m) throw new Error("could not parse LANG_ALIASES out of shiki.ts");
  const out: Record<string, string> = {};
  for (const pair of m[1].matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) {
    out[pair[1]] = pair[2];
  }
  return out;
}

describe("attachmentLanguage", () => {
  it("only ever returns a language the highlighter actually bundles", () => {
    // The load-bearing direction. A mapping outside this set is invisible in
    // the UI (plain monospace) while looking correct in the source file.
    const known = knownLangs();
    const aliases = langAliases();
    const candidates = [
      "a.md", "a.markdown", "a.json", "a.yaml", "a.yml", "a.sh", "a.bash",
      "a.zsh", "a.py", "a.go", "a.rs", "a.ts", "a.tsx", "a.js", "a.jsx",
      "a.mjs", "a.cjs", "a.sql", "a.txt", "a.log", "a.unknown", "noext", "",
    ];
    for (const filename of candidates) {
      const lang = attachmentLanguage(filename);
      if (lang === undefined) continue;
      const resolved = aliases[lang] ?? lang;
      expect(known, `${filename} → ${lang} is not a bundled grammar`).toContain(
        resolved,
      );
    }
  });

  it("maps the extensions the app can highlight", () => {
    const cases: [string, string][] = [
      ["README.md", "markdown"],
      ["notes.markdown", "markdown"],
      ["data.json", "json"],
      ["config.yaml", "yaml"],
      ["config.yml", "yaml"],
      ["run.sh", "bash"],
      ["deploy.py", "python"],
      ["main.go", "go"],
      ["lib.rs", "rust"],
      ["app.ts", "typescript"],
      ["app.tsx", "typescript"],
      ["app.js", "javascript"],
      ["query.sql", "sql"],
    ];
    for (const [filename, expected] of cases) {
      expect(attachmentLanguage(filename), filename).toBe(expected);
    }
  });

  it("leaves text-previewable but unhighlightable extensions undefined", () => {
    // `.txt` / `.log` render through the text preview yet have no grammar;
    // undefined is the honest answer, matching web's `plaintext` sentinel.
    expect(attachmentLanguage("notes.txt")).toBeUndefined();
    expect(attachmentLanguage("server.log")).toBeUndefined();
  });

  it("returns undefined for an unknown or absent extension", () => {
    expect(attachmentLanguage("archive.bin")).toBeUndefined();
    expect(attachmentLanguage("no-extension")).toBeUndefined();
    expect(attachmentLanguage("")).toBeUndefined();
    expect(attachmentLanguage("dir/sub/file")).toBeUndefined();
  });

  it("is case-insensitive and reads through a path and query string", () => {
    expect(attachmentLanguage("dir/APP.PY")).toBe("python");
    expect(attachmentLanguage("dir/app.py?v=2")).toBe("python");
  });
});
