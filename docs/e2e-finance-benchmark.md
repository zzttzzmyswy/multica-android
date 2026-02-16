# Finance Agent-Driven E2E Benchmark

This benchmark suite is designed for complex financial analysis scenarios and follows the workflow in `docs/e2e-testing-guide.md`.

## Scope

- Domain: equity, macro, rates, credit, cross-asset allocation
- Complexity: multi-step planning, data collection, analysis, local artifact generation
- Providers: `kimi-coding` and `claude-code`
- Cases: 10

Case prompts are stored in:
- `scripts/e2e-finance-benchmark/cases/`

## Prerequisites

1. Credentials are configured (`pnpm multica credentials init` if needed)
2. Dev auth exists for `web_search`/`data` tools (`~/.super-multica-dev/auth.json`)
3. Required env:

```bash
export SMC_DATA_DIR=~/.super-multica-e2e
export MULTICA_API_URL=https://api-dev.copilothub.ai
```

## Run All Cases (Both Providers)

```bash
scripts/e2e-finance-benchmark/run.sh
```

The script defaults:
- Providers: `kimi-coding claude-code`
- Case glob: `case-*.txt`
- Max parallel workers: `2`
- Per-case timeout: `900s` (set `CASE_TIMEOUT_SEC=0` to disable)
- Output directory: `.context/finance-e2e-runs/<timestamp>/`

Generated artifact:
- `manifest.tsv`: provider, case id, status, session id, session dir, raw log file

## Run a Subset

Run only one provider:

```bash
PROVIDERS="kimi-coding" scripts/e2e-finance-benchmark/run.sh
```

Run only specific cases by glob:

```bash
CASE_GLOB="case-0[1-3]*.txt" scripts/e2e-finance-benchmark/run.sh
```

Run with higher parallelism for long-horizon tasks:

```bash
MAX_PARALLEL=4 CASE_TIMEOUT_SEC=2700 scripts/e2e-finance-benchmark/run.sh
```

## Case List

1. `case-01-top10-financial-reports.txt`
   - Top-10 US market cap 3-year filing analysis + workbook + 2026 allocation memo
2. `case-02-ai-value-chain-scorecard.txt`
   - AI value-chain factor model and weighted ranking
3. `case-03-us-bank-stress-test.txt`
   - US large-bank stress scenarios (mild/severe recession)
4. `case-04-consumer-sector-macro-linkage.txt`
   - Consumer sector earnings elasticity vs macro variables
5. `case-05-energy-transport-sensitivity.txt`
   - Energy/transport sensitivity and hedge ideas under oil scenarios
6. `case-06-cross-asset-allocation.txt`
   - Cross-asset tactical portfolio design with scenario stress tests
7. `case-07-reit-rate-risk.txt`
   - REIT screening under rate scenarios and debt maturity pressure
8. `case-08-earnings-quality-forensics.txt`
   - Forensic accounting quality framework and red-flag scoring
9. `case-09-post-earnings-drift-study.txt`
   - PEAD strategy feasibility study with risk controls
10. `case-10-investment-committee-pack.txt`
   - Q2 2026 investment committee pack + devil's advocate memo

## Evaluation Checklist

For each run (`session-dir/run-log.jsonl`):

1. Event completeness
   - `run_start` appears before `run_end`
2. Tool pairing
   - Every `tool_start` has matching `tool_end`
3. Error handling
   - Check `tool_end.is_error`, `error_classify`, `auth_rotate`
4. Compaction health
   - If compaction occurs: `compaction.tokens_removed > 0`
5. Performance
   - Inspect `llm_result.duration_ms` and tool durations for outliers

For content quality (`session.jsonl` and output files on Desktop):

1. Required files are created in target output directory
2. Assumptions are explicit and traceable
3. Sources are listed (`sources.md` with links + dates)
4. Output distinguishes facts vs inferences when requested
5. Strategy conclusions include risk and invalidation conditions

## Notes

- Most cases intentionally require web + financial data gathering and local file generation.
- Cases are designed to test planning quality, not only final answer quality.
- You can analyze sessions after batch runs by opening the `session_dir` paths in `manifest.tsv`.
