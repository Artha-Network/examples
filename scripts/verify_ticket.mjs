/**
 * Verify a ResolveTicket signature using tickets-lib (Node 18+, ESM).
 *
 * What this script checks
 * 1) Validates the ticket shape against tickets-lib schema
 * 2) Rebuilds the canonical CBOR bytes from the unsigned fields
 * 3) Verifies the ed25519 signature using the provided public key
 *
 * Inputs
 * - First positional arg: path to a JSON file containing the ticket payload
 *   If omitted, the script reads from STDIN
 *
 * Environment
 *   API_KEY is ignored here
 *   PUBLIC_KEY   optional override for the ticket's public_key field
 *
 * Usage
 *   node example/scripts/verify_ticket.mjs ticket.json
 *   cat ticket.json | node example/scripts/verify_ticket.mjs
 *
 * Exit codes
 *   0  signature is valid
 *   1  bad input or verification failed
 *
 * Security note
 * Do not paste real secrets into files or STDIN
 */

import { readFile } from "node:fs/promises";
import { stdin, exit } from "node:process";
import { schema as TicketSchema, encodeCbor, verify } from "@trust-escrow/tickets-lib";

/* -----------------------------
   Helpers
----------------------------- */

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
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

function hexToBytes(str, label) {
  if (typeof str !== "string" || !/^[0-9a-fA-F]+$/.test(str) || str.length % 2 !== 0) {
    throw new Error(`Invalid hex for ${label}`);
  }
  const out = new Uint8Array(str.length / 2);
  for (let i = 0; i < str.length; i += 2) out[i / 2] = parseInt(str.slice(i, i + 2), 16);
  return out;
}

async function readAllStdin() {
  const chunks = [];
  for await (const c of stdin) chunks.push(c);
  return Buffer.concat(chunks).toString("utf8");
}

/* -----------------------------
   Main
----------------------------- */

(async () => {
  try {
    // 1) Load ticket JSON
    const fileArg = process.argv[2];
    const raw = fileArg ? await readFile(fileArg, "utf8") : await readAllStdin();
    const input = JSON.parse(raw);

    // 2) Pull signature and public key from the JSON
    const sigHex = String(input.signature ?? "").trim();
    const pkOverride = env("PUBLIC_KEY", "");
    const pubKeyRaw = pkOverride ? pkOverride : String(input.public_key ?? "").trim();

    if (!sigHex) throw new Error("Missing signature field in ticket JSON");
    if (!pubKeyRaw) throw new Error("Missing public_key in ticket JSON and PUBLIC_KEY not set");

    const signature = hexToBytes(sigHex, "signature");
    const pubkey = parseKey(pubKeyRaw, "public_key");

    // 3) Build the unsigned message from the known schema fields
    //    The signature is created over the CBOR of this exact structure
    const unsigned = TicketSchema.parse({
      schema: input.schema,
      deal_id: input.deal_id,
      action: input.action,
      split_bps: input.split_bps,
      rationale_cid: input.rationale_cid,
      confidence: input.confidence,
      nonce: input.nonce,
      expires_at: input.expires_at
    });

    const bytes = encodeCbor(unsigned);

    // 4) Verify and report
    const ok = verify(bytes, signature, pubkey);

    const report = {
      ok,
      dealId: unsigned.deal_id,
      action: unsigned.action,
      expires_at: unsigned.expires_at
    };

    console.log(JSON.stringify(report, null, 2));
    exit(ok ? 0 : 1);
  } catch (err) {
    console.error(JSON.stringify({ ok: false, error: String(err) }, null, 2));
    exit(1);
  }
})();
