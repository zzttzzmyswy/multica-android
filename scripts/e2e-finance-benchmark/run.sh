#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/../.." && pwd)"
CASES_DIR="${SCRIPT_DIR}/cases"
TIMESTAMP="$(date +%Y%m%d-%H%M%S)"
OUT_DIR="${ROOT_DIR}/.context/finance-e2e-runs/${TIMESTAMP}"

# Required environment for agent-driven E2E with web_search/data tools.
SMC_DATA_DIR="${SMC_DATA_DIR:-$HOME/.super-multica-e2e}"
MULTICA_API_URL="${MULTICA_API_URL:-https://api-dev.copilothub.ai}"
PROVIDERS_RAW="${PROVIDERS:-kimi-coding claude-code}"
CASE_GLOB="${CASE_GLOB:-case-*.txt}"
CASE_TIMEOUT_SEC="${CASE_TIMEOUT_SEC:-900}"
TIMEOUT_ENABLED="true"
if [[ "${CASE_TIMEOUT_SEC}" =~ ^[0-9]+$ ]] && (( CASE_TIMEOUT_SEC <= 0 )); then
  TIMEOUT_ENABLED="false"
fi

read -r -a PROVIDERS <<< "${PROVIDERS_RAW}"

mkdir -p "${OUT_DIR}"
MANIFEST="${OUT_DIR}/manifest.tsv"
printf "timestamp\tprovider\tcase_id\tstatus\tsession_id\tsession_dir\tlog_file\n" > "${MANIFEST}"

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
if [[ "${TIMEOUT_ENABLED}" == "true" ]]; then
  echo "Case timeout: ${CASE_TIMEOUT_SEC}s"
else
  echo "Case timeout: disabled"
fi

total=0
for provider in "${PROVIDERS[@]}"; do
  for case_file in "${CASE_FILES[@]}"; do
    total=$((total + 1))
    case_base="$(basename "${case_file}")"
    case_id="${case_base%.txt}"
    log_file="${OUT_DIR}/${provider}-${case_id}.log"

    prompt="$(cat "${case_file}")"

    echo
    echo "[${total}] Running ${case_id} with provider=${provider}"

    status="success"
    timed_out="false"
    started_at="$(date +%s)"

    (
      SMC_DATA_DIR="${SMC_DATA_DIR}" \
        MULTICA_API_URL="${MULTICA_API_URL}" \
        pnpm multica run --run-log --provider "${provider}" "${prompt}" > "${log_file}" 2>&1
    ) &
    cmd_pid=$!

    while kill -0 "${cmd_pid}" 2>/dev/null; do
      if [[ "${TIMEOUT_ENABLED}" == "true" ]]; then
        now="$(date +%s)"
        elapsed="$((now - started_at))"
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
    wait "${cmd_pid}" || exit_code=$?
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

    printf "%s\t%s\t%s\t%s\t%s\t%s\t%s\n" \
      "${TIMESTAMP}" \
      "${provider}" \
      "${case_id}" \
      "${status}" \
      "${session_id}" \
      "${session_dir}" \
      "${log_file}" >> "${MANIFEST}"

    echo "status=${status} session=${session_id:-N/A}"
  done
done

echo
echo "Completed. Manifest: ${MANIFEST}"
