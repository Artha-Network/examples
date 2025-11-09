/**
 * Resolve a deal via a signed ResolveTicket (Node 18+, ESM).
 *
 * What this script does
 * 1) Builds a ResolveTicket that matches @trust-escrow/tickets-lib schema
 * 2) Encodes it to canonical CBOR, signs with ed25519 (secret from env)
 * 3) POSTs to /actions/deals/resolve on your actions-server
 *
 * Prerequisites
 * - actions-server running and reachable
 * - tickets-lib available in node_modules (pnpm add @trust-escrow/tickets-lib)
 *
 * Environment variables
 *   BASE_URL                 default http://localhost:8787
 *   API_KEY                  optional Bearer token
 *   DEAL_ID                  required, e.g., D-123
 *   ACTION                   RELEASE or REFUND (default RELEASE)
 *   SPLIT_BPS                optional, default 0
 *   RATIONALE_CID            optional, e.g., bafy... reason blob
 *   CONFIDENCE               optional, default 0.9
 *   TICKET_SECRET            required ed25519 secret (hex or base64)
 *   TICKET_PUBLIC_KEY        required ed25519 public key (hex or base64)
 *   EXPIRES_IN_SEC           optional TTL, default 3600
 *
 * Usage
 *   DEAL_ID=D-123 TICKET_SECRET=hex... TICKET_PUBLIC_KEY=hex... node example/scripts/resolve_via_ticket.mjs
 *
 * Notes
 * - This script prepares a ticket for human or server-side verification; it does not submit any on-chain tx.
 * - Public key is passed explicitly to avoid crypto libs here. Keep your real keys safe.
 */

import { schema as TicketSchema, encodeCbor, sign } from "@trust-escrow/tickets-lib";

/* ---------------------------------------
 * Small helpers
 * ------------------------------------- */

function env(name, fallback, { required = false } = {}) {
  const v = process.env[name];
  if ((v == null || v === "") && required) {
    throw new Error(`Missing required env ${name}`);
  }
  return v == null || v === "" ? fallback : v;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

/** Parse hex or base64 into a Uint8Array without extra deps. */
function parseKey(str, label) {
  if (!str || typeof str !== "string") throw new Error(`Invalid ${label}`);
  const s = str.trim();
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) {
      out[i / 2] = parseInt(s.slice(i, i + 2), 16);
    }
    return out;
  }
  // base64 or base64url
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) throw new Error(`Could not decode ${label}`);
  return new Uint8Array(buf);
}

/* ---------------------------------------
 * Config
 * ------------------------------------- */

const BASE_URL = env("BASE_URL", "http://localhost:8787");
const API_KEY = env("API_KEY", "");
const DEAL_ID = env("DEAL_ID", "", { required: true });
const ACTION = env("ACTION", "RELEASE").toUpperCase();
const SPLIT_BPS = Number(env("SPLIT_BPS", "0"));
const RATIONALE_CID = env("RATIONALE_CID", "bafyPLACEHOLDER");
const CONFIDENCE = Number(env("CONFIDENCE", "0.9"));
const EXPIRES_IN_SEC = Number(env("EXPIRES_IN_SEC", "3600"));

if (!["RELEASE", "REFUND"].includes(ACTION)) {
  throw new Error(`ACTION must be RELEASE or REFUND, got ${ACTION}`);
}

const SECRET = parseKey(env("TICKET_SECRET", "", { required: true }), "TICKET_SECRET");
const PUBKEY = parseKey(env("TICKET_PUBLIC_KEY", "", { required: true }), "TICKET_PUBLIC_KEY");

/* ---------------------------------------
 * Build and sign the ticket
 * ------------------------------------- */

const msg = TicketSchema.parse({
  schema: "escrow.v1.ResolveTicket",
  deal_id: DEAL_ID,
  action: ACTION,
  split_bps: SPLIT_BPS,
  rationale_cid: RATIONALE_CID,
  confidence: CONFIDENCE,
  nonce: 1,
  expires_at: nowSec() + EXPIRES_IN_SEC
});

const bytes = encodeCbor(msg);
const signature = sign(bytes, SECRET); // Uint8Array

function hex(u8) {
  return Buffer.from(u8).toString("hex");
}

const ticket = {
  ...msg,
  signature: hex(signature),
  public_key: hex(PUBKEY)
};

/* ---------------------------------------
 * POST to actions-server
 * ------------------------------------- */

async function postJSON(path, body) {
  const url = `${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
  const headers = { "content-type": "application/json" };
  if (API_KEY) headers.authorization = `Bearer ${API_KEY}`;
  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 500)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { ok: true, raw: text };
  }
}

const payload = { dealId: DEAL_ID, ticket };

console.log(JSON.stringify({ step: "build", dealId: DEAL_ID, action: ACTION, baseUrl: BASE_URL }, null, 2));

postJSON("/actions/deals/resolve", payload)
  .then(r => {
    console.log(JSON.stringify({ step: "resolve:ok", response: r }, null, 2));
  })
  .catch(err => {
    console.error(JSON.stringify({ step: "resolve:error", error: String(err) }, null, 2));
    process.exitCode = 1;
  });
