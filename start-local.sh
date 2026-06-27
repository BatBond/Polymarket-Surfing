#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# start-local.sh — run the Kalshi AI Brain on your own machine
#
# This bypasses ALL cloud platforms (Vercel, Render, Railway) and runs the
# app directly on your laptop. Your home internet's DNS resolver is not
# subject to cloud platform blocks, so api.kalshi.com will resolve normally.
#
# Usage:
#   ./start-local.sh
#
# Then open http://localhost:3000 in your browser.
#
# For a PUBLIC URL (so the dashboard is reachable from anywhere, including
# your phone), install cloudflared and run:
#   cloudflared tunnel --url http://localhost:3000
# Cloudflare will give you a free public https://*.trycloudflare.com URL.
# ---------------------------------------------------------------------------

set -e

cd "$(dirname "$0")"

echo "=== Kalshi AI Brain — Local Runner ==="
echo ""

# Check Node is installed
if ! command -v node >/dev/null 2>&1; then
  echo "✗ Node.js is not installed. Install from https://nodejs.org/ (LTS version) and re-run."
  exit 1
fi

# Check npm is installed
if ! command -v npm >/dev/null 2>&1; then
  echo "✗ npm is not installed. Install Node.js from https://nodejs.org/ and re-run."
  exit 1
fi

echo "✓ Node.js $(node --version) detected"
echo ""

# Install dependencies if not already done
if [ ! -d "node_modules" ]; then
  echo "Installing dependencies (first run only)..."
  npm install --no-audit --no-fund
  echo ""
fi

# Check for env vars (warn if missing, but still start)
if [ -z "$KALSHI_KEY_ID" ] && [ ! -f ".env" ]; then
  echo "⚠ KALSHI_KEY_ID is not set in environment."
  echo "  To enable LIVE trading, either:"
  echo "    1. Create a .env file in this folder with:"
  echo "         KALSHI_KEY_ID=your_key_id"
  echo "         KALSHI_PRIVATE_KEY_PEM=-----BEGIN RSA PRIVATE KEY-----..."
  echo "    2. Or export them in your shell before running this script:"
  echo "         export KALSHI_KEY_ID=your_key_id"
  echo "         export KALSHI_PRIVATE_KEY_PEM=\$(cat kalshi_private.pem)"
  echo ""
  echo "  Starting anyway in PAPER mode (no real trades)."
  echo ""
fi

# Load .env if it exists (simple parser — for production use dotenv)
if [ -f ".env" ]; then
  echo "Loading .env..."
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
  echo ""
fi

echo "=========================================="
echo "  Starting server on http://localhost:3000"
echo "=========================================="
echo ""
echo "Press Ctrl+C to stop."
echo ""

node server.js
