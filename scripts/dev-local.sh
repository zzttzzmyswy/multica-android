#!/usr/bin/env bash
#
# Local development: Gateway (with Telegram bot) + Desktop
#
# Usage:
#   pnpm dev:local
#
# Reads TELEGRAM_BOT_TOKEN from .env at the repo root.
# Gateway runs in long-polling mode (no TELEGRAM_WEBHOOK_URL needed).
# Desktop connects to the local Gateway at http://localhost:3000.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ROOT_DIR="$SCRIPT_DIR/.."
ENV_FILE="$ROOT_DIR/.env"

# Load .env
if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  echo "Copy .env.example to .env and fill in TELEGRAM_BOT_TOKEN"
  exit 1
fi

set -a
source "$ENV_FILE"
set +a

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not set in .env"
  exit 1
fi

echo "Starting local dev environment..."
echo "  Gateway:  http://localhost:3000 (Telegram long-polling mode)"
echo "  Desktop:  connecting to local Gateway"
echo ""

# Build shared packages first
pnpm turbo build --filter=@multica/types --filter=@multica/utils --filter=@multica/core

# Start everything
exec pnpm concurrently \
  -n types,utils,core,gateway,desktop \
  -c blue,green,yellow,magenta,cyan \
  "pnpm --filter @multica/types dev" \
  "pnpm --filter @multica/utils dev" \
  "pnpm --filter @multica/core dev" \
  "pnpm --filter @multica/gateway dev" \
  "GATEWAY_URL=http://localhost:3000 pnpm --filter @multica/desktop dev"
