/**
 * Send a signed test webhook to jobs-service Helius endpoint (Node 18+, ESM).
 *
 * Purpose
 * - Exercise jobs-service webhook intake end to end without a real provider.
 * - Builds a minimal payload that normalizeHeliusWebhook will accept.
 * - Computes the X-Helius-Signature header as HMAC SHA256 over the raw body.
 *
 * What this script does
 * 1) Reads env vars for endpoint, secret, and event fields
 * 2) Creates a JSON payload that includes a deal id and event type
 * 3) Signs the raw body with HELIUS_WEBHOOK_SECRET
 * 4) POSTs to the jobs-service webhook URL with proper headers
 * 5) Prints the response
 *
 * Requirements
 * - jobs-service running with HELIUS_WEBHOOK_SECRET set to the same value
 * - Node 18 or newer
 *
 * Environment variables
 *   JOBS_URL                default http://localhost:8788/webhooks/helius
 *   HELIUS_WEBHOOK_SECRET   required, shared secret used by jobs-service
 *   DEAL_ID                 required, e.g., D-123
 *   TYPE                    one of: deal-funded, deal-delivered, deal-disputed, deal-released, deal-refunded
 *                           default deal-funded
 *   SIG                     fake tx signature for correlation, default DEMO_SIG_111
 *   SLOT                    optional integer, default 0
 *   WHEN                    optional unix seconds, default now
 *   WEBHOOK_ID              optional header X-Webhook-Id for idempotency derivation
 *
 * Usage
 *   DEAL_ID=D-1 HELIUS_WEBHOOK_SECRET=devsecret node example/scripts/send_test_helius_webhook.mjs
 *   TYPE=deal-delivered DEAL_ID=D-2 HELIUS_WEBHOOK_SECRET=devsecret node example/scripts/send_test_helius_webhook.mjs
 *
 * Notes
 * - Payload shape matches what the jobs-service normalizer expects:
 *     { events: [ { type, signature, slot, timestamp, dealId } ] }
 * - Signature header is lowercase hex of HMAC SHA256 raw body.
 */

import { createHmac } from "node:crypto";

/* -----------------------------
   Helpers
----------------------------- */

function env(name, fallback, { required = false } = {}) {
  const v = process.env[name];
  if ((v == null || v === "") && required) {
    throw new Error(`Missing env ${name}`);
  }
  return v == null || v === "" ? fallback : v;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

function hmacHexSHA256(secret, rawBody) {
  return createHmac("sha256", Buffer.from(secret)).update(rawBody).digest("hex");
}

/* -----------------------------
   Config
----------------------------- */

const JOBS_URL = env("JOBS_URL", "http://localhost:8788/webhooks/helius");
const SECRET = env("HELIUS_WEBHOOK_SECRET", "", { required: true });
const DEAL_ID = env("DEAL_ID", "", { required: true });
const TYPE = env("TYPE", "deal-funded");
const SIG = env("SIG", "DEMO_SIG_111");
const SLOT = Number(env("SLOT", "0"));
const WHEN = Number(env("WHEN", String(nowSec())));
const WEBHOOK_ID = env("WEBHOOK_ID", "");

// Validate type
const ALLOWED = new Set(["deal-funded", "deal-delivered", "deal-disputed", "deal-released", "deal-refunded"]);
if (!ALLOWED.has(TYPE)) {
  throw new Error(`TYPE must be one of ${Array.from(ALLOWED).join(", ")}`);
}

/* -----------------------------
   Build and sign payload
----------------------------- */

const payload = {
  events: [
    {
      type: TYPE,
      signature: SIG,     // jobs-service accepts signature or sig
      slot: SLOT,
      timestamp: WHEN,    // jobs-service maps timestamp to when
      dealId: DEAL_ID
    }
  ]
};

const raw = Buffer.from(JSON.stringify(payload));
const signature = hmacHexSHA256(SECRET, raw);

/* -----------------------------
   POST
----------------------------- */

async function main() {
  const headers = {
    "content-type": "application/json",
    "x-helius-signature": signature
  };
  if (WEBHOOK_ID) headers["x-webhook-id"] = WEBHOOK_ID;

  const res = await fetch(JOBS_URL, { method: "POST", headers, body: raw });
  const text = await res.text();
  const body = (() => {
    try {
      return JSON.parse(text);
    } catch {
      return { raw: text };
    }
  })();

  const out = {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    request: {
      url: JOBS_URL,
      headers,
      payload
    },
    response: body
  };

  console.log(JSON.stringify(out, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err) }, null, 2));
  process.exit(1);
});
