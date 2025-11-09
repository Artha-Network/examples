#!/usr/bin/env bash
# Artha Actions end to end flow: initiate → fund → deliver → release → status
#
# What this script does
# 1. Hits the health endpoint
# 2. Initiates a deal and captures dealId
# 3. Builds a funding transaction for the buyer
# 4. Marks delivery with a demo evidence CID
# 5. Releases funds to the seller
# 6. Fetches final status
#
# Requirements
# - bash, curl, jq
# - actions-server running locally or reachable over HTTP
#
# Usage
#   chmod +x example/scripts/e2e_flow.sh
#   example/scripts/e2e_flow.sh
#
# Configuration
# Reads variables from environment first, then falls back to defaults.
# You can also create an .env file next to this script and it will be sourced.
#
# BASE_URL              default http://localhost:8787
# API_KEY               optional Bearer token
# BUYER                 buyer wallet public key
# SELLER                seller wallet public key
# MINT                  logical asset symbol, default USDC
# AMOUNT                human amount, default 1.00
# DELIVERY_BY           ISO 8601, default 2025-11-30T23:59:59Z
# DISPUTE_HOURS         default 48
# EVIDENCE_CID          default bafyDEMO
#
set -euo pipefail

# Load .env if present
ENV_FILE="$(dirname "$0")/../.env"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  . "$ENV_FILE"
fi

BASE_URL="${BASE_URL:-http://localhost:8787}"
API_KEY="${API_KEY:-}"
BUYER="${BUYER:-BuyerWalletPublicKeyHere}"
SELLER="${SELLER:-SellerWalletPublicKeyHere}"
MINT="${MINT:-USDC}"
AMOUNT="${AMOUNT:-1.00}"
DELIVERY_BY="${DELIVERY_BY:-2025-11-30T23:59:59Z}"
DISPUTE_HOURS="${DISPUTE_HOURS:-48}"
EVIDENCE_CID="${EVIDENCE_CID:-bafyDEMO}"

# Pretty printer
say() { printf "\n== %s ==\n" "$*"; }

# JSON helper using jq so we do not hand craft JSON strings
jobj() {
  jq -n \
    --arg title "$1" \
    --arg buyer "$2" \
    --arg seller "$3" \
    --arg mint "$4" \
    --arg delivery "$5" \
    --argjson amount "$6" \
    --argjson hours "$7" \
    '{title:$title,buyer:$buyer,seller:$seller,amount:$amount,mint:$mint,deliveryBy:$delivery,disputeWindowHours:$hours}'
}

# Curl wrapper that adds auth header if API_KEY is set
req() {
  local method="$1" path="$2" body="${3:-}"
  local url="${BASE_URL%/}/${path#/}"
  if [ -n "$API_KEY" ]; then
    AUTH_HEADER="Authorization: Bearer $API_KEY"
  else
    AUTH_HEADER=""
  fi
  if [ -n "$body" ]; then
    curl -sSf -X "$method" "$url" \
      -H "$AUTH_HEADER" \
      -H "Content-Type: application/json" \
      --data-binary "$body"
  else
    curl -sSf -X "$method" "$url" -H "$AUTH_HEADER"
  fi
}

# 1) Health
say "Health"
req GET "/health" | jq -C .

# 2) Initiate
say "Initiate deal"
INIT_BODY="$(jobj "Script escrow: demo gadget" "$BUYER" "$SELLER" "$MINT" "$DELIVERY_BY" "$AMOUNT" "$DISPUTE_HOURS")"
INIT_RES="$(req POST "/actions/deals/initiate" "$INIT_BODY")"
echo "$INIT_RES" | jq -C .
DEAL_ID="$(echo "$INIT_RES" | jq -r '.dealId // empty')"
if [ -z "$DEAL_ID" ]; then
  echo "Failed to get dealId from initiate response" >&2
  exit 1
fi
say "dealId = $DEAL_ID"

# 3) Fund
say "Build funding transaction"
FUND_BODY="$(jq -n --arg d "$DEAL_ID" --arg p "$BUYER" '{dealId:$d,payer:$p}')"
FUND_RES="$(req POST "/actions/deals/fund" "$FUND_BODY")"
echo "$FUND_RES" | jq -C .

# 4) Deliver
say "Mark delivered"
DELIVER_BODY="$(jq -n --arg d "$DEAL_ID" --arg cid "$EVIDENCE_CID" --arg note "Shipped via devnet courier" '{dealId:$d,evidenceCid:$cid,note:$note}')"
DELIVER_RES="$(req POST "/actions/deals/deliver" "$DELIVER_BODY")"
echo "$DELIVER_RES" | jq -C .

# 5) Release
say "Release funds"
RELEASE_BODY="$(jq -n --arg d "$DEAL_ID" --arg a "$BUYER" '{dealId:$d,approver:$a}')"
RELEASE_RES="$(req POST "/actions/deals/release" "$RELEASE_BODY")"
echo "$RELEASE_RES" | jq -C .

# 6) Status
say "Fetch status"
req GET "/actions/deals/$DEAL_ID" | jq -C .

say "Done"
