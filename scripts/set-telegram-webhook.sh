#!/usr/bin/env bash
#
# Set Telegram Bot Webhook
#
# Usage:
#   ./scripts/set-telegram-webhook.sh <webhook_url>
#
# Example:
#   ./scripts/set-telegram-webhook.sh https://your-domain.ngrok-free.dev
#
# Reads TELEGRAM_BOT_TOKEN and TELEGRAM_WEBHOOK_SECRET_TOKEN from .env

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

if [ ! -f "$ENV_FILE" ]; then
  echo "Error: .env file not found at $ENV_FILE"
  exit 1
fi

source "$ENV_FILE"

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  echo "Error: TELEGRAM_BOT_TOKEN not set in .env"
  exit 1
fi

WEBHOOK_BASE_URL="${1:-}"

if [ -z "$WEBHOOK_BASE_URL" ]; then
  echo "Usage: $0 <webhook_base_url>"
  echo ""
  echo "Example:"
  echo "  $0 https://your-domain.ngrok-free.dev"
  exit 1
fi

# Remove trailing slash
WEBHOOK_BASE_URL="${WEBHOOK_BASE_URL%/}"
WEBHOOK_URL="${WEBHOOK_BASE_URL}/telegram/webhook"

echo "Bot Token:    ${TELEGRAM_BOT_TOKEN:0:10}..."
echo "Secret Token: ${TELEGRAM_WEBHOOK_SECRET_TOKEN:0:8}..."
echo "Webhook URL:  $WEBHOOK_URL"
echo ""

# Set webhook
echo "=> Setting webhook..."
RESPONSE=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook" \
  -d "url=${WEBHOOK_URL}" \
  -d "secret_token=${TELEGRAM_WEBHOOK_SECRET_TOKEN:-}")

echo "$RESPONSE" | python3 -m json.tool 2>/dev/null || echo "$RESPONSE"

echo ""
echo "=> Verifying webhook info..."
INFO=$(curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo")
echo "$INFO" | python3 -m json.tool 2>/dev/null || echo "$INFO"
