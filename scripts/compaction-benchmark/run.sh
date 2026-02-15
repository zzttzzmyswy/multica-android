#!/usr/bin/env bash
# Compaction Benchmark - Multi-turn test with low context window
#
# This script runs a series of prompts against the Multica agent with a very
# low context window (20k tokens) to force compaction to trigger quickly.
# The run-log output is then available for analysis.
#
# Usage:
#   bash scripts/compaction-benchmark/run.sh [provider]
#
# Default provider: kimi-coding

set -euo pipefail

PROVIDER="${1:-kimi-coding}"
CONTEXT_WINDOW="${2:-20000}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"

export SMC_DATA_DIR=~/.super-multica-e2e

echo "=== Compaction Benchmark ==="
echo "Provider: $PROVIDER"
echo "Context Window: $CONTEXT_WINDOW tokens"
echo "Data Dir: $SMC_DATA_DIR"
echo ""

# Clean previous E2E data
rm -rf "$SMC_DATA_DIR"

cd "$ROOT_DIR"

# Turn 1: Start a session with a substantial prompt that generates tool usage
echo "--- Turn 1: Initial prompt (read multiple files) ---"
TURN1_OUTPUT=$(SMC_DATA_DIR="$SMC_DATA_DIR" pnpm multica run \
  --run-log \
  --provider "$PROVIDER" \
  --context-window "$CONTEXT_WINDOW" \
  "Read the following files and give me a brief summary of each: packages/core/src/agent/runner.ts, packages/core/src/agent/session/session-manager.ts, packages/core/src/agent/context-window/token-estimation.ts. List the main exports and key functions in each file." \
  2>&1)

# Extract session ID from stderr output
SESSION_ID=$(echo "$TURN1_OUTPUT" | grep -o '\[session: [^]]*\]' | head -1 | sed 's/\[session: //;s/\]//')
SESSION_DIR=$(echo "$TURN1_OUTPUT" | grep -o '\[session-dir: [^]]*\]' | head -1 | sed 's/\[session-dir: //;s/\]//')

if [ -z "$SESSION_ID" ]; then
  echo "ERROR: Could not extract session ID from output"
  echo "$TURN1_OUTPUT"
  exit 1
fi

echo "Session ID: $SESSION_ID"
echo "Session Dir: $SESSION_DIR"
echo ""

# Turn 2: Continue the session with more file reads to push context higher
echo "--- Turn 2: More file reads (push context higher) ---"
TURN2_OUTPUT=$(SMC_DATA_DIR="$SMC_DATA_DIR" pnpm multica run \
  --run-log \
  --provider "$PROVIDER" \
  --context-window "$CONTEXT_WINDOW" \
  --session "$SESSION_ID" \
  "Now also read packages/core/src/agent/context-window/summarization.ts and packages/core/src/agent/context-window/tool-result-pruning.ts. Describe the key algorithms in each." \
  2>&1)

echo "$TURN2_OUTPUT" | head -5
echo ""

# Turn 3: More context-heavy work
echo "--- Turn 3: Additional analysis (should trigger compaction) ---"
TURN3_OUTPUT=$(SMC_DATA_DIR="$SMC_DATA_DIR" pnpm multica run \
  --run-log \
  --provider "$PROVIDER" \
  --context-window "$CONTEXT_WINDOW" \
  --session "$SESSION_ID" \
  "Read packages/core/src/agent/session/compaction.ts and explain the three compaction modes. Also read packages/core/src/agent/context-window/guard.ts and explain the guard thresholds." \
  2>&1)

echo "$TURN3_OUTPUT" | head -5
echo ""

# Turn 4: More tool usage
echo "--- Turn 4: Write and test (more context pressure) ---"
TURN4_OUTPUT=$(SMC_DATA_DIR="$SMC_DATA_DIR" pnpm multica run \
  --run-log \
  --provider "$PROVIDER" \
  --context-window "$CONTEXT_WINDOW" \
  --session "$SESSION_ID" \
  "Based on everything you've read so far, list all the constants and thresholds used in the compaction system. Provide exact values and which file each is defined in." \
  2>&1)

echo "$TURN4_OUTPUT" | head -5
echo ""

# Output analysis summary
echo "=== Benchmark Complete ==="
echo "Session Dir: $SESSION_DIR"
echo ""

# Show run-log stats
if [ -f "$SESSION_DIR/run-log.jsonl" ]; then
  echo "--- Run Log Event Summary ---"
  echo "Total events: $(wc -l < "$SESSION_DIR/run-log.jsonl")"
  echo ""
  echo "Events by type:"
  cat "$SESSION_DIR/run-log.jsonl" | python3 -c "
import sys, json
from collections import Counter
events = Counter()
for line in sys.stdin:
    try:
        obj = json.loads(line.strip())
        events[obj.get('event', 'unknown')] += 1
    except:
        pass
for event, count in sorted(events.items()):
    print(f'  {event}: {count}')
" 2>/dev/null || echo "  (python3 not available for analysis)"
  echo ""

  echo "--- Compaction Events ---"
  cat "$SESSION_DIR/run-log.jsonl" | python3 -c "
import sys, json
for line in sys.stdin:
    try:
        obj = json.loads(line.strip())
        event = obj.get('event', '')
        if 'compact' in event or 'overflow' in event or 'pruning' in event:
            print(json.dumps(obj, indent=2))
    except:
        pass
" 2>/dev/null || echo "  (python3 not available for analysis)"
fi

echo ""
echo "=== Full run-log path: $SESSION_DIR/run-log.jsonl ==="
echo "=== Session file path: $SESSION_DIR/session.jsonl ==="
