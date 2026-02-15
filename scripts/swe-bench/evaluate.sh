#!/usr/bin/env bash
#
# Evaluate Multica predictions against SWE-bench using the official Docker harness.
#
# Prerequisites:
#   pip install swebench
#   Docker running with at least 120GB storage, 16GB RAM, 8 CPU cores
#
# Usage:
#   bash scripts/swe-bench/evaluate.sh [predictions.jsonl] [dataset] [run_id]
#
# Examples:
#   bash scripts/swe-bench/evaluate.sh
#   bash scripts/swe-bench/evaluate.sh scripts/swe-bench/predictions.jsonl lite multica-v1

set -euo pipefail

PREDICTIONS="${1:-scripts/swe-bench/predictions.jsonl}"
DATASET="${2:-lite}"
RUN_ID="${3:-multica}"

# Map short names to HuggingFace dataset names
case "$DATASET" in
  lite)     DATASET_NAME="princeton-nlp/SWE-bench_Lite" ;;
  verified) DATASET_NAME="princeton-nlp/SWE-bench_Verified" ;;
  full)     DATASET_NAME="princeton-nlp/SWE-bench" ;;
  *)        DATASET_NAME="$DATASET" ;;
esac

echo "=== SWE-bench Evaluation ==="
echo "Predictions: $PREDICTIONS"
echo "Dataset:     $DATASET_NAME"
echo "Run ID:      $RUN_ID"
echo ""

if [ ! -f "$PREDICTIONS" ]; then
  echo "Error: Predictions file not found: $PREDICTIONS"
  exit 1
fi

TASK_COUNT=$(wc -l < "$PREDICTIONS" | tr -d ' ')
echo "Tasks to evaluate: $TASK_COUNT"
echo ""

# Check if swebench is installed
if ! python -c "import swebench" 2>/dev/null; then
  echo "Error: swebench not installed. Run: pip install swebench"
  exit 1
fi

# Check if Docker is running
if ! docker info >/dev/null 2>&1; then
  echo "Error: Docker is not running"
  exit 1
fi

echo "Starting evaluation (this may take a while)..."
echo ""

python -m swebench.harness.run_evaluation \
  --dataset_name "$DATASET_NAME" \
  --predictions_path "$PREDICTIONS" \
  --max_workers 4 \
  --run_id "$RUN_ID"

echo ""
echo "=== Evaluation Complete ==="
echo "Check logs/ and evaluation_results/ for detailed results."
