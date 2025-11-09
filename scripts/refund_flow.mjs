/**
 * Refund path demo: initiate → fund → open dispute → refund → status (Node 18+, ESM)
 *
 * What this script does
 * 1) Checks server health
 * 2) Initiates a deal and captures dealId
 * 3) Builds a funding transaction for the buyer (ready-to-sign payload or Blink)
 * 4) Opens a dispute (simulates delivery failure or defect)
 * 5) Requests a refund to the buyer (seller or reviewer approves per your API)
 * 6) Fetches final status
 *
 * Requirements
 * - actions-server running and reachable
 * - Node 18+ (uses global fetch)
 *
 * Environment variables (edit or export before running)
 *   BASE_URL              default http://localhost:8787
 *   API_KEY               optional Bearer token
 *   BUYER                 buyer wallet public key (string)
 *   SELLER                seller wallet public key (string)
 *   MINT                  logical asset symbol (default USDC)
 *   AMOUNT                human amount (default 1.00)
 *   DELIVERY_BY           ISO 8601 datetime (default 2025-11-30T23:59:59Z)
 *   DISPUTE_HOURS         default 48
 *   DISPUTE_REASON        default "Item not received"
 *   DISPUTE_CID           default "bafyDEMO-DISPUTE"
 *
 * Usage
 *   node example/scripts/refund_flow.mjs
 *
 * Notes
 * - This script expects your server to accept the refund with:
 *     POST /actions/deals/refund { dealId, approver }
 *   where approver is typically the seller (depending on your policy).
 * - If your server enforces arbitration tickets for refunds, use the
 *   resolve_via_ticket.mjs script instead of the direct refund call.
 */

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

// -----------------------------
// Config
// -----------------------------
const BASE_URL = env("BASE_URL", "http://localhost:8787");
const API_KEY = env("API_KEY", "");
const BUYER = env("BUYER", "BuyerWalletPublicKeyHere");
const SELLER = env("SELLER", "SellerWalletPublicKeyHere");
const MINT = env("MINT", "USDC");
const AMOUNT = Number(env("AMOUNT", "1.00"));
const DELIVERY_BY = env("DELIVERY_BY", "2025-11-30T23:59:59Z");
const DISPUTE_HOURS = Number(env("DISPUTE_HOURS", "48"));
const DISPUTE_REASON = env("DISPUTE_REASON", "Item not received");
const DISPUTE_CID = env("DISPUTE_CID", "bafyDEMO-DISPUTE");

// -----------------------------
// HTTP helpers
// -----------------------------
function url(path) {
  return `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function headers() {
  const h = { "content-type": "application/json" };
  if (API_KEY) h.authorization = `Bearer ${API_KEY}`;
  return h;
}

async function http(method, path, body) {
  const res = await fetch(url(path), {
    method,
    headers: headers(),
    body: body ? JSON.stringify(body) : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function show(step, obj) {
  // Compact pretty print
  try {
    console.log(`\n### ${step}\n${JSON.stringify(obj, null, 2).slice(0, 2000)}`);
  } catch {
    console.log(`\n### ${step}\n${String(obj)}`);
  }
}

// -----------------------------
// Flow
// -----------------------------
(async () => {
  // 1) Health
  const health = await http("GET", "/health");
  show("Health", health);

  // 2) Initiate
  const initiateBody = {
    title: "Refund path demo: item not received",
    buyer: BUYER,
    seller: SELLER,
    amount: AMOUNT,
    mint: MINT,
    deliveryBy: DELIVERY_BY,
    disputeWindowHours: DISPUTE_HOURS
  };
  const init = await http("POST", "/actions/deals/initiate", initiateBody);
  show("Initiate", init);
  const dealId = init.dealId;
  if (!dealId) throw new Error("Server did not return dealId");

  // 3) Fund
  // If your server returned a Blink or serialized tx in the initiate step,
  // you can skip this and let the wallet fund. Otherwise, request a funding tx.
  const fundReq = { dealId, payer: BUYER };
  const fund = await http("POST", "/actions/deals/fund", fundReq);
  show("Fund (tx or Blink)", fund);

  // 4) Open dispute (simulate failure)
  const disputeReq = { dealId, reason: DISPUTE_REASON, evidenceCid: DISPUTE_CID };
  const dispute = await http("POST", "/actions/deals/dispute", disputeReq);
  show("Dispute opened", dispute);

  // 5) Refund to buyer (approver = seller by default policy)
  const refundReq = { dealId, approver: SELLER };
  const refund = await http("POST", "/actions/deals/refund", refundReq);
  show("Refund", refund);

  // 6) Status
  const status = await http("GET", `/actions/deals/${encodeURIComponent(dealId)}`);
  show("Final status", status);
})().catch(err => {
  console.error(JSON.stringify({ error: String(err) }, null, 2));
  process.exitCode = 1;
});
