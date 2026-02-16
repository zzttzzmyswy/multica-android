# Skills Agent-Driven E2E Benchmark

This benchmark validates the meta skill workflow for capability-gap discovery, ClawHub installation, and security-gated rollout.

## Scope

- Domain: skill discovery + installation + update
- Focus: `skills/meta-skill-installer`
- Providers: default `kimi-coding` (override with `PROVIDERS`)
- Cases: 3

Case prompts are stored in:
- `scripts/e2e-skills-benchmark/cases/`

## Real ClawHub Examples Used

The case set references real public pages from ClawHub:

- [CalDAV Calendar](https://clawhub.ai/skills/caldav-calendar)
- [Home Assistant](https://clawhub.ai/skills/homeassistant)
- [CodexMonitor](https://clawhub.ai/odrobnik/codexmonitor)

## Prerequisites

1. Credentials configured (`pnpm multica credentials init` if needed)
2. Dependencies installed in repo (`pnpm install`)
3. `clawhub` CLI available, or allow runtime fallback to `npx -y clawhub`
4. Required env:

```bash
export SMC_DATA_DIR=~/.super-multica-e2e
export MULTICA_API_URL=https://api-dev.copilothub.ai
```

## Run Benchmark

```bash
scripts/e2e-skills-benchmark/run.sh
```

Defaults:

- Providers: `kimi-coding`
- Case glob: `case-*.txt`
- Max parallel workers: `1`
- Per-case timeout: `1200s` (`CASE_TIMEOUT_SEC=0` to disable)
- Output directory: `.context/skills-e2e-runs/<timestamp>/`

Generated artifacts:

- `manifest.tsv`: provider/case/status/session/log metadata
- `analysis.txt`: human-readable pass/fail report
- `analysis.json`: structured detailed check output

## Run Subset

Only one case:

```bash
CASE_GLOB="case-01-*.txt" scripts/e2e-skills-benchmark/run.sh
```

Multiple providers:

```bash
PROVIDERS="kimi-coding claude-code" scripts/e2e-skills-benchmark/run.sh
```

Faster throughput:

```bash
MAX_PARALLEL=2 CASE_TIMEOUT_SEC=1800 scripts/e2e-skills-benchmark/run.sh
```

## Analyzer Checks

For each run:

1. `run_start` and `run_end` both present
2. `run_end.error` is empty/null
3. `tool_start` and `tool_end` are paired
4. no `tool_end.is_error=true`
5. at least one `exec` tool call exists
6. case-specific command evidence in `tool_start.args`:
   - `clawhub search`
   - `clawhub install`
   - `review-skill-security.mjs`
   - for case 03 also `clawhub update`

## Notes

- These are agent-driven tests; prompt intent plus run-log evidence are both evaluated.
- `SMC_DATA_DIR=~/.super-multica-e2e` avoids polluting normal user skill/session data.
- If a case fails, open `manifest.tsv` and inspect the matching `session_dir/run-log.jsonl`.
