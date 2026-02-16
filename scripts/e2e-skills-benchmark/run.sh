#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CASES_DIR="${SCRIPT_DIR}/cases"
TIMESTAMP="${TIMESTAMP:-$(date +%Y%m%d-%H%M%S)}"
OUT_DIR="${OUT_DIR:-${ROOT_DIR}/.context/skills-e2e-runs/${TIMESTAMP}}"
RESULTS_DIR="${OUT_DIR}/results"
MANIFEST="${OUT_DIR}/manifest.tsv"

# Required environment for agent-driven E2E.
SMC_DATA_DIR="${SMC_DATA_DIR:-$HOME/.super-multica-e2e}"
MULTICA_API_URL="${MULTICA_API_URL:-https://api-dev.copilothub.ai}"
PROVIDERS_RAW="${PROVIDERS:-kimi-coding}"
CASE_GLOB="${CASE_GLOB:-case-*.txt}"
CASE_TIMEOUT_SEC="${CASE_TIMEOUT_SEC:-1200}"
MAX_PARALLEL="${MAX_PARALLEL:-1}"
TIMEOUT_ENABLED="true"
if [[ "${CASE_TIMEOUT_SEC}" =~ ^[0-9]+$ ]] && (( CASE_TIMEOUT_SEC <= 0 )); then
  TIMEOUT_ENABLED="false"
fi

if ! [[ "${MAX_PARALLEL}" =~ ^[0-9]+$ ]] || (( MAX_PARALLEL <= 0 )); then
  echo "MAX_PARALLEL must be a positive integer, got: ${MAX_PARALLEL}" >&2
  exit 1
fi

if [[ "${1:-}" == "--worker" ]]; then
  provider="${2:?missing provider}"
  case_file="${3:?missing case file}"
  case_base="$(basename "${case_file}")"
  case_id="${case_base%.txt}"
  log_file="${OUT_DIR}/${provider}-${case_id}.log"
  result_file="${RESULTS_DIR}/${provider}-${case_id}.tsv"

  prompt="$(cat "${case_file}")"

  status="success"
  timed_out="false"
  started_epoch="$(date +%s)"
  started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

  SMC_DATA_DIR="${SMC_DATA_DIR}" \
    MULTICA_API_URL="${MULTICA_API_URL}" \
    pnpm multica run --run-log --provider "${provider}" "${prompt}" > "${log_file}" 2>&1 &
  cmd_pid=$!

  while kill -0 "${cmd_pid}" 2>/dev/null; do
    if [[ "${TIMEOUT_ENABLED}" == "true" ]]; then
      now="$(date +%s)"
      elapsed="$((now - started_epoch))"
      if (( elapsed >= CASE_TIMEOUT_SEC )); then
        timed_out="true"
        kill "${cmd_pid}" 2>/dev/null || true
        sleep 1
        kill -9 "${cmd_pid}" 2>/dev/null || true
        break
      fi
    fi
    sleep 2
  done

  exit_code=0
  wait "${cmd_pid}" 2>/dev/null || exit_code=$?
  ended_epoch="$(date +%s)"
  ended_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  duration_sec="$((ended_epoch - started_epoch))"

  if [[ "${timed_out}" == "true" ]]; then
    status="timeout"
    printf "\n[runner] timed out after %ss\n" "${CASE_TIMEOUT_SEC}" >> "${log_file}"
  elif (( exit_code != 0 )); then
    status="failed"
  elif [[ ! -s "${log_file}" ]]; then
    status="failed"
  elif ! rg -q "\[session: " "${log_file}"; then
    status="failed"
  fi

  session_id="$(rg -o "\[session: [^]]+\]" "${log_file}" | tail -n 1 | sed -E 's/\[session: ([^]]+)\]/\1/' || true)"
  session_dir="$(rg -o "\[session-dir: [^]]+\]" "${log_file}" | tail -n 1 | sed -E 's/\[session-dir: ([^]]+)\]/\1/' || true)"

  printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
    "${TIMESTAMP}" \
    "${provider}" \
    "${case_id}" \
    "${status}" \
    "${session_id}" \
    "${session_dir}" \
    "${log_file}" \
    "${started_at}" \
    "${ended_at}" \
    "${duration_sec}" \
    "${exit_code}" > "${result_file}"

  printf "[worker] provider=%s case=%s status=%s duration=%ss session=%s\n" \
    "${provider}" \
    "${case_id}" \
    "${status}" \
    "${duration_sec}" \
    "${session_id:-N/A}"
  exit 0
fi

mkdir -p "${OUT_DIR}"
mkdir -p "${RESULTS_DIR}"
printf "timestamp\tprovider\tcase_id\tstatus\tsession_id\tsession_dir\tlog_file\tstarted_at\tended_at\tduration_sec\texit_code\n" > "${MANIFEST}"

read -r -a PROVIDERS <<< "${PROVIDERS_RAW}"

CASE_FILES=()
while IFS= read -r line; do
  CASE_FILES+=("${line}")
done < <(find "${CASES_DIR}" -maxdepth 1 -type f -name "${CASE_GLOB}" | sort)

if [[ ${#CASE_FILES[@]} -eq 0 ]]; then
  echo "No case files matched ${CASE_GLOB} in ${CASES_DIR}" >&2
  exit 1
fi

echo "Output directory: ${OUT_DIR}"
echo "Using SMC_DATA_DIR=${SMC_DATA_DIR}"
echo "Using MULTICA_API_URL=${MULTICA_API_URL}"
echo "Providers: ${PROVIDERS[*]}"
echo "Cases: ${#CASE_FILES[@]}"
echo "Max parallel: ${MAX_PARALLEL}"
if [[ "${TIMEOUT_ENABLED}" == "true" ]]; then
  echo "Case timeout: ${CASE_TIMEOUT_SEC}s"
else
  echo "Case timeout: disabled"
fi

TASKS=()
for provider in "${PROVIDERS[@]}"; do
  for case_file in "${CASE_FILES[@]}"; do
    TASKS+=("${provider}" "${case_file}")
  done
done

echo "Total tasks: $(( ${#TASKS[@]} / 2 ))"

export TIMESTAMP OUT_DIR RESULTS_DIR SMC_DATA_DIR MULTICA_API_URL CASE_TIMEOUT_SEC TIMEOUT_ENABLED
printf '%s\0' "${TASKS[@]}" | xargs -0 -n 2 -P "${MAX_PARALLEL}" bash "${BASH_SOURCE[0]}" --worker

RESULT_FILES=()
while IFS= read -r line; do
  RESULT_FILES+=("${line}")
done < <(find "${RESULTS_DIR}" -maxdepth 1 -type f -name "*.tsv" | sort)

if [[ ${#RESULT_FILES[@]} -eq 0 ]]; then
  echo "No result files produced in ${RESULTS_DIR}" >&2
  exit 1
fi

for result_file in "${RESULT_FILES[@]}"; do
  cat "${result_file}" >> "${MANIFEST}"
done

success_count="$(awk -F '\t' 'NR>1 && $4=="success" {c++} END{print c+0}' "${MANIFEST}")"
failed_count="$(awk -F '\t' 'NR>1 && $4=="failed" {c++} END{print c+0}' "${MANIFEST}")"
timeout_count="$(awk -F '\t' 'NR>1 && $4=="timeout" {c++} END{print c+0}' "${MANIFEST}")"

echo
echo "Completed run stage. Manifest: ${MANIFEST}"
echo "Run summary: success=${success_count} failed=${failed_count} timeout=${timeout_count}"

echo
echo "Running structured analysis..."
node "${SCRIPT_DIR}/analyze.mjs" "${MANIFEST}" | tee "${OUT_DIR}/analysis.txt"
