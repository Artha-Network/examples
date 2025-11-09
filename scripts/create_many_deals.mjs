/**
 * Bulk-create demo deals for quick testing (Node 18+, ESM).
 *
 * What this script does
 * - Creates COUNT initiate-requests against your actions-server
 * - Staggers requests with a small delay to avoid bursts
 * - Prints a compact summary table with the returned dealIds
 *
 * Defaults are safe for devnet. It does NOT fund or finalize anything.
 *
 * Environment variables
 *   BASE_URL           default http://localhost:8787
 *   API_KEY            optional Bearer token
 *   BUYER              buyer wallet public key
 *   SELLER             seller wallet public key
 *   MINT               logical asset (default USDC)
 *   AMOUNT             human amount per deal (default 1.00)
 *   DISPUTE_HOURS      default 48
 *   COUNT              how many deals to create (default 5)
 *   SPREAD_MINUTES     how far into the future to spread deliveryBy (default 60)
 *   START_DELAY_MS     delay before first request (default 0)
 *   BETWEEN_MS         delay between requests (default 250)
 *   TITLE_PREFIX       default "Bulk demo"
 *
 * Usage
 *   node example/scripts/create_many_deals.mjs
 *   COUNT=20 BETWEEN_MS=100 node example/scripts/create_many_deals.mjs
 *
 * Notes
 * - If your server returns a Blink URL or tx in the response, this script
 *   ignores it; it only inventories created deals.
 * - Keep AMOUNT tiny for dev/test. This script doesn’t touch funds.
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
const DISPUTE_HOURS = Number(env("DISPUTE_HOURS", "48"));
const COUNT = Math.max(1, Number(env("COUNT", "5")));
const SPREAD_MIN = Math.max(1, Number(env("SPREAD_MINUTES", "60")));
const START_DELAY_MS = Math.max(0, Number(env("START_DELAY_MS", "0")));
const BETWEEN_MS = Math.max(0, Number(env("BETWEEN_MS", "250")));
const TITLE_PREFIX = env("TITLE_PREFIX", "Bulk demo");

// -----------------------------
// Helpers
// -----------------------------
function url(path) {
  return `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function headers() {
  const h = { "content-type": "application/json" };
  if (API_KEY) h.authorization = `Bearer ${API_KEY}`;
  return h;
}

function isoInMinutes(minutesFromNow) {
  const t = Date.now() + minutesFromNow * 60 * 1000;
  return new Date(t).toISOString();
}

async function post(path, body) {
  const res = await fetch(url(path), {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body)
  });
  const txt = await res.text();
  if (!
