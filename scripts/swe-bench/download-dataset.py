#!/usr/bin/env python3
"""
Download SWE-bench dataset from HuggingFace and export to JSONL for the Node.js runner.

Usage:
  pip install datasets
  python scripts/swe-bench/download-dataset.py [--dataset verified|lite|full] [--limit N] [--output PATH]

Output format (one JSON object per line):
  {
    "instance_id": "django__django-16379",
    "repo": "django/django",
    "base_commit": "abc123...",
    "problem_statement": "...",
    "hints_text": "...",
    "patch": "...",           # gold patch (for reference, not shown to agent)
    "test_patch": "...",      # test patch applied during evaluation
    "version": "4.2",
    "environment_setup_commit": "..."
  }
"""

import argparse
import json
import sys

DATASET_MAP = {
    "verified": "princeton-nlp/SWE-bench_Verified",
    "lite": "princeton-nlp/SWE-bench_Lite",
    "full": "princeton-nlp/SWE-bench",
}


def main():
    parser = argparse.ArgumentParser(description="Download SWE-bench dataset to JSONL")
    parser.add_argument(
        "--dataset",
        choices=["verified", "lite", "full"],
        default="lite",
        help="Dataset variant (default: lite)",
    )
    parser.add_argument(
        "--limit", type=int, default=0, help="Limit number of instances (0 = all)"
    )
    parser.add_argument(
        "--output",
        type=str,
        default=None,
        help="Output JSONL path (default: scripts/swe-bench/<dataset>.jsonl)",
    )
    parser.add_argument(
        "--split",
        type=str,
        default="test",
        help="Dataset split (default: test)",
    )
    args = parser.parse_args()

    try:
        from datasets import load_dataset
    except ImportError:
        print("Error: 'datasets' package not installed. Run: pip install datasets", file=sys.stderr)
        sys.exit(1)

    dataset_name = DATASET_MAP[args.dataset]
    output_path = args.output or f"scripts/swe-bench/{args.dataset}.jsonl"

    print(f"Downloading {dataset_name} (split={args.split})...", file=sys.stderr)
    ds = load_dataset(dataset_name, split=args.split)

    # Fields to keep
    keep_fields = [
        "instance_id",
        "repo",
        "base_commit",
        "problem_statement",
        "hints_text",
        "patch",
        "test_patch",
        "version",
        "environment_setup_commit",
    ]

    count = 0
    with open(output_path, "w") as f:
        for item in ds:
            record = {}
            for field in keep_fields:
                if field in item:
                    record[field] = item[field]
            f.write(json.dumps(record, ensure_ascii=False) + "\n")
            count += 1
            if args.limit and count >= args.limit:
                break

    print(f"Wrote {count} instances to {output_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
