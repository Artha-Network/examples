/**
 * Generate an Ed25519 keypair for ResolveTicket signing (Node 18+, ESM).
 *
 * What this script does
 * - Creates a fresh Ed25519 keypair using Node's crypto module
 * - Prints the secret/public keys in hex and base64
 * - Can emit .env-ready lines or JSON for automation
 *
 * Usage
 *   node example/scripts/gen_ed25519_keys.mjs
 *   node example/scripts/gen_ed25519_keys.mjs --env
 *   node example/scripts/gen_ed25519_keys.mjs --json
 *
 * Output formats
 *   default  : human-readable table with hex and base64
 *   --env    : TICKET_SECRET=..., TICKET_PUBLIC_KEY=... (hex)
 *   --json   : {"secretHex": "...", "publicHex": "...", "secretB64": "...", "publicB64": "..."}
 *
 * Security notes
 * - These keys are for local/dev only. Do NOT commit real secrets.
 * - Store the secret safely. Anyone with it can forge ResolveTickets.
 */

import { generateKeyPairSync } from "crypto";

/* ---------------------------------------
 * CLI args
 * ------------------------------------- */
const args = new Set(process.argv.slice(2));
const wantEnv = args.has("--env");
const wantJson = args.has("--json");

if (args.has("--help") || args.has("-h")) {
  console.log(`
gen_ed25519_keys.mjs

Generate an Ed25519 keypair suitable for signing ResolveTickets.

Flags:
  --env   Print .env lines (hex) for TICKET_SECRET/TICKET_PUBLIC_KEY
  --json  Print a JSON object with hex and base64 variants
  -h      Show this help

Examples:
  node example/scripts/gen_ed25519_keys.mjs
  node example/scripts/gen_ed25519_keys.mjs --env > example/.env
  node example/scripts/gen_ed25519_keys.mjs --json | jq .
`.trim());
  process.exit(0);
}

/* ---------------------------------------
 * Generate keypair
 * ------------------------------------- */
const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
  // PEM to raw Uint8Array conversion is not needed; export as DER and slice.
  publicKeyEncoding: { type: "spki", format: "der" },
  privateKeyEncoding: { type: "pkcs8", format: "der" }
});

/**
 * Extract raw 32-byte keys from DER encodings.
 * Ed25519:
 *  - public SPKI DER ends with 32-byte raw public key
 *  - private PKCS#8 DER ends with 34 bytes, last 32 are the secret scalar
 */
function rawPubFromSpki(spkiDer) {
  // The raw public key is the last 32 bytes of the SPKI DER
  return new Uint8Array(spkiDer.buffer, spkiDer.byteOffset + spkiDer.byteLength - 32, 32);
}
function rawSecretFromPkcs8(pkcs8Der) {
  // The raw secret is the last 32 bytes of the PKCS#8 DER
  return new Uint8Array(pkcs8Der.buffer, pkcs8Der.byteOffset + pkcs8Der.byteLength - 32, 32);
}

const rawPub = rawPubFromSpki(publicKey);
const rawSecret = rawSecretFromPkcs8(privateKey);

/* ---------------------------------------
 * Encoders
 * ------------------------------------- */
const toHex = (u8) => Buffer.from(u8).toString("hex");
const toB64 = (u8) => Buffer.from(u8).toString("base64");

const out = {
  secretHex: toHex(rawSecret),
  publicHex: toHex(rawPub),
  secretB64: toB64(rawSecret),
  publicB64: toB64(rawPub)
};

/* ---------------------------------------
 * Print in requested format
 * ------------------------------------- */
if (wantEnv) {
  // .env prefers hex so it’s copy/paste friendly
  console.log(`TICKET_SECRET=${out.secretHex}`);
  console.log(`TICKET_PUBLIC_KEY=${out.publicHex}`);
  process.exit(0);
}

if (wantJson) {
  console.log(JSON.stringify(out));
  process.exit(0);
}

// Default: friendly table
const pad = (s, n) => (s.length >= n ? s : s + " ".repeat(n - s.length));
console.log("\nGenerated Ed25519 keypair (dev/test use only)\n");
console.log(`${pad("Public (hex)", 16)}: ${out.publicHex}`);
console.log(`${pad("Secret (hex)", 16)}: ${out.secretHex}`);
console.log(`${pad("Public (base64)", 16)}: ${out.publicB64}`);
console.log(`${pad("Secret (base64)", 16)}: ${out.secretB64}`);
console.log(`
Next steps
1) Put these into your env for the ticket script:
   TICKET_SECRET=${out.secretHex}
   TICKET_PUBLIC_KEY=${out.publicHex}

2) Run the ResolveTicket script:
   DEAL_ID=D-123 TICKET_SECRET=${out.secretHex} TICKET_PUBLIC_KEY=${out.publicHex} \\
   node example/scripts/resolve_via_ticket.mjs

Keep secrets out of version control. Seriously.
`.trim());
