/**
 * Build a ResolveTicket JSON file using tickets-lib (Node 18+, ESM).
 *
 * What this script does
 * 1) Reads config from env
 * 2) Validates fields with tickets-lib schema
 * 3) Encodes canonical CBOR and signs with ed25519
 * 4) Writes a JSON file that your server or verifier can consume
 *
 * Inputs (env)
 *   DEAL_ID               required
 *   ACTION                RELEASE or REFUND (default RELEASE)
 *   SPLIT_BPS             default 0
 *   RATIONALE_CID         optional, e.g., bafy... blob
 *   CONFIDENCE            default 0.9
 *   EXPIRES_IN_SEC        default 3600
 *   TICKET_SECRET         required, ed25519 secret (hex or base64)
 *   TICKET_PUBLIC_KEY     required, ed25519 public key (hex or base64)
 *
 * Positional arg
 *   path to output file, default ticket.json
 *
 * Usage
 *   DEAL_ID=D-123 TICKET_SECRET=hex TICKET_PUBLIC_KEY=hex node example/scripts/build_ticket_json.mjs
 *   DEAL_ID=D-123 node example/scripts/build_ticket_json.mjs my_ticket.json
 *
 * Security note
 *   Use throwaway dev keys. Do not commit real secrets.
 */

import { writeFile } from "node:fs/promises";
import { schema as TicketSchema, encodeCbor, sign } from "@trust-escrow/tickets-lib";

/* ---------------------------------------
 * Helpers
 * ------------------------------------- */

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

/** Parse hex or base64 into Uint8Array */
function parseKey(str, label) {
  if (!str || typeof str !== "string") throw new Error(`Invalid ${label}`);
  const s = str.trim();
  if (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0) {
    const out = new Uint8Array(s.length / 2);
    for (let i = 0; i < s.length; i += 2) out[i / 2] = parseInt(s.slice(i, i + 2), 16);
    return out;
  }
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const buf = Buffer.from(b64, "base64");
  if (buf.length === 0) throw new Error(`Could not decode ${label}`);
  return new Uint8Array(buf);
}

const toHex = (u8) => Buffer.from(u8).toString("hex");

/* ---------------------------------------
 * Config
 * ------------------------------------- */

const DEAL_ID = env("DEAL_ID", "", { required: true });
const ACTION = env("ACTION", "RELEASE").toUpperCase();
if (!["RELEASE", "REFUND"].includes(ACTION)) {
  throw new Error(`ACTION must be RELEASE or REFUND, got ${ACTION}`);
}
const SPLIT_BPS = Number(env("SPLIT_BPS", "0"));
const RATIONALE_CID = env("RATIONALE_CID", "bafyPLACEHOLDER");
const CONFIDENCE = Number(env("CONFIDENCE", "0.9"));
const EXPIRES_IN_SEC = Number(env("EXPIRES_IN_SEC", "3600"));

const SECRET = parseKey(env("TICKET_SECRET", "", { required: true }), "TICKET_SECRET");
const PUBKEY = parseKey(env("TICKET_PUBLIC_KEY", "", { required: true }), "TICKET_PUBLIC_KEY");

const OUT_PATH = process.argv[2] || "ticket.json";

/* ---------------------------------------
 * Build and sign
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
const sig = sign(bytes, SECRET);

const ticket = {
  ...msg,
  signature: toHex(sig),
  public_key: toHex(PUBKEY)
};

/* ---------------------------------------
 * Write file
 * ------------------------------------- */

await writeFile(OUT_PATH, JSON.stringify(ticket, null, 2), "utf8");

console.log(JSON.stringify({ ok: true, path: OUT_PATH, dealId: DEAL_ID, action: ACTION }, null, 2));
