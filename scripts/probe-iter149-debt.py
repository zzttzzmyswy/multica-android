#!/usr/bin/env python3
"""Iteration 149 probe 4: the "remaining debt" entry point.

The 148 round entered by "words that appear in the English source". The angle it
never took is the reverse: **Latin words still sitting in the ja/ko prose that
the bundle itself already renders natively elsewhere**. That is where leftover
debt hides, and it is measurable without a term list.

Also checks the `PR` abbreviation: the guard pins `Pull request` casing, but if
`PR` is used where English says "pull request", the guard's pattern would have to
see it.
"""
import json
import re
from collections import Counter, defaultdict
from pathlib import Path

LOCALES = Path(__file__).resolve().parent.parent / "packages/views/locales"


def flatten(value, prefix=""):
    if value is None or not isinstance(value, (dict, list)):
        return {prefix: str(value)}
    if isinstance(value, list):
        out = {}
        for i, child in enumerate(value):
            out.update(flatten(child, f"{prefix}.{i}" if prefix else str(i)))
        return out
    out = {}
    for key, child in value.items():
        out.update(flatten(child, f"{prefix}.{key}" if prefix else key))
    return out


def load(locale):
    bundle = {}
    for path in sorted((LOCALES / locale).glob("*.json")):
        ns = path.stem
        for key, value in flatten(json.loads(path.read_text(encoding="utf-8"))).items():
            bundle[f"{ns}.{key}"] = value
    return bundle


EN, JA, KO = (load(x) for x in ("en", "ja", "ko"))

# Same masking the guard uses, so the scan sees what the guard sees.
MASKED = [
    r"SKILL\.md", r"Skills\.sh", r"skill-name", r"@squad", r"Agent Builder",
    r"agent/…", r"my-workspace", r"\{\{[^}]*\}\}", r"`[^`]*`",
    r"\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b",
]
LATIN_WORD = re.compile(r"(?<![A-Za-z])[A-Za-z][A-Za-z-]{3,}(?![A-Za-z])")

# Latin words that are legitimately kept: brands, acronyms, CLI, identifiers.
KEEP = {
    "multica", "github", "slack", "google", "anthropic", "openai", "claude",
    "codex", "cursor", "linear", "jira", "lark", "wecom", "dingtalk", "composio",
    "stripe", "hermes", "http", "https", "websocket", "json", "yaml", "oauth",
    "postgres", "sqlite", "docker", "kubernetes", "shell", "bash", "zsh",
    "npm", "pnpm", "node", "python", "go", "rust", "api", "cli", "url", "sdk",
    "jwt", "sso", "sql", "html", "css", "svg", "png", "pdf", "csv", "uuid",
    "webhook", "webhooks", "plugin", "plugins", "host", "release", "releases",
    "bundled", "catalog", "endpoint", "endpoints", "proxy", "token", "tokens",
    "prompt", "prompts", "patch", "diff", "stdin", "stdout", "stdio", "jsonl",
    "mcp", "ide", "cpu", "ram", "gpu", "os", "ai", "id", "ids", "ui", "ux",
    "ok", "pdf", "xlsx", "docx", "katex", "mermaid", "tailscale", "electron",
    "macos", "windows", "linux", "android", "ios", "expo", "react", "vite",
    "vitest", "jest", "eslint", "prettier", "typescript", "javascript",
    "manifest", "config", "runtime", "runtimes", "daemon", "agent", "agents",
    "workspace", "workspaces", "project", "projects", "issue", "issues",
    "skill", "skills", "squad", "squads", "task", "tasks", "inbox", "label",
    "labels", "comment", "comments", "reply", "replies", "member", "members",
    "owner", "admin", "settings", "notifications", "autopilot", "autopilots",
    "app", "apps", "bot", "bots", "docs", "readme", "key", "keys", "path",
    "get", "post", "put", "delete", "patch", "head", "options", "cors",
    "pr", "pull", "request", "requests", "base", "url", "uri", "utf", "tls",
    "ssl", "ssh", "gpg", "pgp", "ip", "dns", "cdn", "cron", "yml", "toml",
    "skill.md", "shared", "true", "false", "null", "undefined", "json", "text",
    "markdown", "html", "image", "file", "files", "dir", "folder", "root",
    "public", "private", "local", "remote", "default", "custom", "new", "old",
    "live", "ready", "busy", "error", "warning", "info", "debug", "trace",
    "log", "logs", "logfile", "stdout", "stderr", "exit", "code", "codes",
}


def mask(value):
    out = value
    for pattern in MASKED:
        out = re.sub(pattern, "…", out)
    return out


print("=" * 74)
print("A. Latin words left in ja/ko prose that the OTHER locale renders natively")
print("=" * 74)

latin_by_locale = {}
for name, bundle in (("ja", JA), ("ko", KO)):
    counter = Counter()
    where = defaultdict(list)
    for key, value in bundle.items():
        for m in LATIN_WORD.finditer(mask(value)):
            word = m.group(0)
            if word.lower() in KEEP:
                continue
            counter[word] += 1
            where[word].append(key)
    latin_by_locale[name] = (counter, where)
    print(f"\n{name}: {len(counter)} distinct non-allowlisted Latin words, "
          f"{sum(counter.values())} occurrences")
    for word, count in counter.most_common(40):
        print(f"    {word!r} x{count}   e.g. {where[word][0]}")

print()
print("=" * 74)
print("B. `PR` — where does it appear, and does English say 'pull request' there?")
print("=" * 74)
PR = re.compile(r"(?<![A-Za-z])PR(?![A-Za-z])")
for name, bundle in (("ja", JA), ("ko", KO), ("en", EN)):
    keys = [k for k, v in bundle.items() if PR.search(mask(v))]
    print(f"\n{name}: {len(keys)} keys contain a bare `PR`")
    for k in keys:
        print(f"    {k}: {bundle[k]!r}")

print()
print("=" * 74)
print("C. Half-width parentheses in ja/ko — are any of them NOT prose?")
print("=" * 74)
HALF = re.compile(r"\(([^()]*)\)")
for name, bundle in (("ja", JA), ("ko", KO)):
    code_like = []
    for key, value in bundle.items():
        for content in HALF.findall(value):
            if re.search(r"[{}\[\]<>=/\\|]|--|\bapi\b|\.md\b|_", content, re.I):
                code_like.append((key, content))
    print(f"\n{name}: {len(code_like)} half-width pairs whose content looks code-like")
    for key, content in code_like:
        print(f"    {key}: {content!r}   <- {bundle[key]!r}")
