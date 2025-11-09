/**
 * Wait for a deal to reach a target state, polling the Actions server.
 *
 * What this script does
 * 1) Reads configuration from env or positional args
 * 2) Calls GET /actions/deals/:dealId repeatedly
 * 3) Exits zero when state matches the target, non-zero on timeout or error
 *
 * Requirements
 * - Node 18 or newer
 * - Actions server reachable via BASE_URL
 *
 * Usage
 *   node example/scripts/wait_until_state.mjs
 *   node example/scripts/wait_until_state.mjs D-123 RELEASED
 *   node example/scripts/wait_until_state.mjs D-123 RELEASED 180 2000
 *
 * Inputs
 *   Env variables:
 *     BASE_URL       default http://localhost:8787
 *     API_KEY        optional Bearer token
 *     DEAL_ID        required if not passed positionally
 *     TARGET_STATE   required if not passed positionally
 *     TIMEOUT_SEC    optional, default 120
 *     INTERVAL_MS    optional, default 2500
 *
 *   Positional args (override env if set):
 *     arg1 = deal id
 *     arg2 = target state, one of:
 *            INIT, FUNDED, DELIVERED, DISPUTED, RESOLVED, RELEASED, REFUNDED
 *     arg3 = timeout seconds
 *     arg4 = poll interval milliseconds
 *
 * Notes
 * - This script only polls the server and prints compact progress logs.
 * - It does not submit transactions or alter state.
 */

function env(name, fallback, { required = false } = {}) {
  const v = process.env[name];
  if ((v == null || v === "") && required) {
    throw new Error(`Missing required env ${name}`);
  }
  return v == null || v === "" ? fallback : v;
}

// Read positional args
const argv = process.argv.slice(2);
const DEAL_ID = argv[0] || env("DEAL_ID", "", { required: false });
const TARGET_STATE = (argv[1] || env("TARGET_STATE", "", { required: false })).toUpperCase();
const TIMEOUT_SEC = Number(argv[2] || env("TIMEOUT_SEC", "120"));
const INTERVAL_MS = Number(argv[3] || env("INTERVAL_MS", "2500"));

// Base config
const BASE_URL = env("BASE_URL", "http://localhost:8787");
const API_KEY = env("API_KEY", "");

// Validate inputs
const VALID_STATES = new Set(["INIT","FUNDED","DELIVERED","DISPUTED","RESOLVED","RELEASED","REFUNDED"]);
if (!DEAL_ID) {
  fail("Provide a deal id via DEAL_ID or as the first argument");
}
if (!TARGET_STATE || !VALID_STATES.has(TARGET_STATE)) {
  fail("Provide TARGET_STATE as one of INIT, FUNDED, DELIVERED, DISPUTED, RESOLVED, RELEASED, REFUNDED");
}
if (!Number.isFinite(TIMEOUT_SEC) || TIMEOUT_SEC <= 0) {
  fail("TIMEOUT_SEC must be a positive number");
}
if (!Number.isFinite(INTERVAL_MS) || INTERVAL_MS <= 0) {
  fail("INTERVAL_MS must be a positive number");
}

function fail(msg) {
  console.error(JSON.stringify({ ok: false, error: msg }, null, 2));
  process.exit(1);
}

function url(path) {
  return `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function headers() {
  const h = {};
  if (API_KEY) h.authorization = `Bearer ${API_KEY}`;
  return h;
}

async function getStatus(dealId) {
  const res = await fetch(url(`/actions/deals/${encodeURIComponent(dealId)}`), {
    method: "GET",
    headers: headers()
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

(async () => {
  const startedAt = Date.now();
  const deadline = startedAt + TIMEOUT_SEC * 1000;

  console.log(JSON.stringify({
    step: "wait-start",
    dealId: DEAL_ID,
    target: TARGET_STATE,
    baseUrl: BASE_URL,
    timeoutSec: TIMEOUT_SEC,
    intervalMs: INTERVAL_MS
  }, null, 2));

  let lastState = null;

  while (Date.now() < deadline) {
    try {
      const status = await getStatus(DEAL_ID);
      const state = String(status?.state || status?.result?.state || "").toUpperCase();
      if (state && state !== lastState) {
        lastState = state;
        console.log(JSON.stringify({
          step: "status",
          dealId: DEAL_ID,
          state,
          elapsedSec: Math.round((Date.now() - startedAt) / 1000)
        }, null, 2));
      }
      if (state === TARGET_STATE) {
        console.log(JSON.stringify({
          step: "wait-ok",
          dealId: DEAL_ID,
          state: TARGET_STATE,
          elapsedSec: Math.round((Date.now() - startedAt) / 1000)
        }, null, 2));
        process.exit(0);
      }
    } catch (err) {
      console.log(JSON.stringify({
        step: "status-error",
        message: String(err).slice(0, 500),
        elapsedSec: Math.round((Date.now() - startedAt) / 1000)
      }, null, 2));
      // Keep polling unless time is up
    }
    await sleep(INTERVAL_MS);
  }

  console.error(JSON.stringify({
    step: "wait-timeout",
    dealId: DEAL_ID,
    target: TARGET_STATE,
    elapsedSec: Math.round((Date.now() - startedAt) / 1000)
  }, null, 2));
  process.exit(1);
})().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err) }, null, 2));
  process.exit(1);
});
