#!/usr/bin/env bash
set -euo pipefail

# ==========================================================================
# Full verification pipeline: typecheck → unit tests → Go tests → E2E
# Usage: bash scripts/check.sh
# ==========================================================================

ENV_FILE="${ENV_FILE:-$(if [ -f .env ]; then echo .env; elif [ -f .env.worktree ]; then echo .env.worktree; else echo .env; fi)}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
fi

POSTGRES_DB="${POSTGRES_DB:-multica}"
POSTGRES_USER="${POSTGRES_USER:-multica}"
POSTGRES_PORT="${POSTGRES_PORT:-5432}"
PORT="${PORT:-8080}"
FRONTEND_PORT="${FRONTEND_PORT:-3000}"
PLAYWRIGHT_BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:${FRONTEND_PORT}}"
export PLAYWRIGHT_BASE_URL

COMPOSE_CMD=(docker compose --env-file "$ENV_FILE")

BACKEND_PID=""
FRONTEND_PID=""
STARTED_BACKEND=false
STARTED_FRONTEND=false
EXIT_CODE=0

# --------------------------------------------------------------------------
# Cleanup: kill only services this script started
# --------------------------------------------------------------------------
cleanup() {
  echo ""
  if [ "$STARTED_BACKEND" = true ] && [ -n "$BACKEND_PID" ]; then
    kill "$BACKEND_PID" 2>/dev/null && wait "$BACKEND_PID" 2>/dev/null || true
    echo "    Stopped backend (PID $BACKEND_PID)"
  fi
  if [ "$STARTED_FRONTEND" = true ] && [ -n "$FRONTEND_PID" ]; then
    kill "$FRONTEND_PID" 2>/dev/null && wait "$FRONTEND_PID" 2>/dev/null || true
    echo "    Stopped frontend (PID $FRONTEND_PID)"
  fi
  echo ""
  if [ "$EXIT_CODE" -eq 0 ]; then
    echo "✓ All checks passed."
  else
    echo "✗ Checks FAILED."
  fi
  exit "$EXIT_CODE"
}
trap cleanup EXIT

# --------------------------------------------------------------------------
# Utility: wait until a port responds
# --------------------------------------------------------------------------
wait_for_port() {
  local port=$1 name=$2 max_wait=${3:-60} path=${4:-/}
  local elapsed=0
  echo "    Waiting for $name on :$port..."
  while ! curl -sf "http://localhost:${port}${path}" > /dev/null 2>&1; do
    sleep 1
    elapsed=$((elapsed + 1))
    if [ "$elapsed" -ge "$max_wait" ]; then
      echo "    ERROR: $name did not start within ${max_wait}s"
      EXIT_CODE=1
      exit 1
    fi
  done
  echo "    $name ready (${elapsed}s)"
}

# --------------------------------------------------------------------------
# Step 0: Ensure DB
# --------------------------------------------------------------------------
echo "==> Using env file: $ENV_FILE"
echo "==> Checking PostgreSQL..."
if pg_isready -h localhost -p "$POSTGRES_PORT" -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null 2>&1; then
  echo "    Already running."
else
  echo "    Starting via docker compose..."
  "${COMPOSE_CMD[@]}" up -d
  until "${COMPOSE_CMD[@]}" exec -T postgres pg_isready -U "$POSTGRES_USER" -d "$POSTGRES_DB" > /dev/null 2>&1; do
    sleep 1
  done
  echo "    PostgreSQL ready."
fi

# --------------------------------------------------------------------------
# Step 1: TypeScript typecheck
# --------------------------------------------------------------------------
echo ""
echo "==> [1/5] TypeScript typecheck..."
pnpm typecheck || { EXIT_CODE=1; exit 1; }

# --------------------------------------------------------------------------
# Step 2: TypeScript unit tests (Vitest)
# --------------------------------------------------------------------------
echo ""
echo "==> [2/5] TypeScript unit tests..."
pnpm test || { EXIT_CODE=1; exit 1; }

# --------------------------------------------------------------------------
# Step 3: Go tests
# --------------------------------------------------------------------------
echo ""
echo "==> [3/5] Go tests..."
(cd server && go test ./...) || { EXIT_CODE=1; exit 1; }

# --------------------------------------------------------------------------
# Step 4: Start services for E2E (only if not already running)
# --------------------------------------------------------------------------
echo ""
echo "==> [4/5] Starting services for E2E..."

if curl -sf "http://localhost:${PORT}/health" > /dev/null 2>&1; then
  echo "    Backend already running on :$PORT"
else
  echo "    Starting backend..."
  (cd server && go run ./cmd/server) > /tmp/multica-check-backend.log 2>&1 &
  BACKEND_PID=$!
  STARTED_BACKEND=true
  wait_for_port "$PORT" "Backend" 90 "/health"
fi

if curl -sf "http://localhost:${FRONTEND_PORT}" > /dev/null 2>&1; then
  echo "    Frontend already running on :$FRONTEND_PORT"
else
  echo "    Starting frontend..."
  pnpm dev:web > /tmp/multica-check-frontend.log 2>&1 &
  FRONTEND_PID=$!
  STARTED_FRONTEND=true
  wait_for_port "$FRONTEND_PORT" "Frontend" 120 "/"
fi

# --------------------------------------------------------------------------
# Step 5: E2E tests (Playwright)
# --------------------------------------------------------------------------
echo ""
echo "==> [5/5] E2E tests (Playwright)..."
pnpm exec playwright test || { EXIT_CODE=1; exit 1; }
