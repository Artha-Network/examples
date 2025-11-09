/**
 * Export recent deals from the Actions server to a CSV file (Node 18+, ESM).
 *
 * What this script does
 * 1) Calls GET /actions/deals?limit=N (and optional cursor if your server supports it)
 * 2) Normalizes common fields from each deal into a flat record
 * 3) Writes a CSV file to disk (default: deals.csv)
 *
 * Requirements
 * - actions-server running and reachable
 * - Node 18+ (uses global fetch and fs/promises)
 *
 * Environment variables
 *   BASE_URL        default http://localhost:8787
 *   API_KEY         optional Bearer token
 *   LIMIT           default 25
 *   CURSOR          optional pagination cursor if your API supports it
 *   OUT             output CSV path (default deals.csv)
 *
 * Usage
 *   node example/scripts/list_deals_to_csv.mjs
 *   LIMIT=100 OUT=out/deals-$(date +%F).csv node example/scripts/list_deals_to_csv.mjs
 *
 * Notes
 * - This script tolerates two response shapes:
 *     A) { items: [...], nextCursor?: "..." }
 *     B) [...array of deals...]
 * - If fields are missing, they are left blank in the CSV.
 * - You can safely run this on devnet/testnet data; amounts are treated as human numbers.
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/* ---------------------------------------
 * Helpers
 * ------------------------------------- */

function env(name, fallback) {
  const v = process.env[name];
  return v == null || v === "" ? fallback : v;
}

const BASE_URL = env("BASE_URL", "http://localhost:8787");
const API_KEY = env("API_KEY", "");
const LIMIT = Math.max(1, Number(env("LIMIT", "25")));
const CURSOR = env("CURSOR", "");
const OUT = env("OUT", "deals.csv");

function url(path, query = {}) {
  const u = new URL(`${BASE_URL.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`);
  for (const [k, v] of Object.entries(query)) {
    if (v !== undefined && v !== null && v !== "") u.searchParams.set(k, String(v));
  }
  return u.toString();
}

async function get(path, query) {
  const res = await fetch(url(path, query), {
    headers: API_KEY ? { authorization: `Bearer ${API_KEY}` } : undefined
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText}: ${text.slice(0, 600)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return [];
  }
}

function pick(obj, key, fallback = "") {
  const parts = key.split(".");
  let cur = obj;
  for (const p of parts) {
    if (cur == null) return fallback;
    cur = cur[p];
  }
  return cur == null ? fallback : cur;
}

function toISO(secOrIso) {
  if (secOrIso == null || secOrIso === "") return "";
  if (typeof secOrIso === "number") {
    if (!Number.isFinite(secOrIso) || secOrIso <= 0) return "";
    return new Date(secOrIso * 1000).toISOString();
  }
  // If it already looks like ISO
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(secOrIso))) return String(secOrIso);
  // Try parse as ms
  const n = Number(secOrIso);
  if (Number.isFinite(n) && n > 10000000000) return new Date(n).toISOString();
  return String(secOrIso);
}

function csvEscape(s) {
  const str = s == null ? "" : String(s);
  if (/[",\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

function toCSV(rows, headers) {
  const head = headers.map(csvEscape).join(",");
  const body = rows
    .map(r => headers.map(h => csvEscape(r[h] ?? "")).join(","))
    .join("\n");
  return `${head}\n${body}\n`;
}

/* ---------------------------------------
 * Mapping
 * ------------------------------------- */
/**
 * We try to cover typical deal shapes:
 * {
 *   id, state, buyer, seller, amount, mint,
 *   createdAt, deliveryBy, disputeUntil, lastSignature
 * }
 * If your server uses different field names, adjust mappings below.
 */

const HEADERS = [
  "id",
  "state",
  "buyer",
  "seller",
  "amount",
  "mint",
  "createdAt",
  "deliveryBy",
  "disputeUntil",
  "lastSignature"
];

function normalizeDeal(d) {
  return {
    id: pick(d, "id") || pick(d, "dealId"),
    state: String(pick(d, "state", "")).toUpperCase(),
    buyer: pick(d, "buyer") || pick(d, "parties.buyer"),
    seller: pick(d, "seller") || pick(d, "parties.seller"),
    amount: pick(d, "amount", ""),
    mint: pick(d, "mint", ""),
    createdAt: toISO(pick(d, "createdAt") || pick(d, "created_at") || pick(d, "timestamps.created")),
    deliveryBy: toISO(pick(d, "deliveryBy") || pick(d, "deadlines.deliveryBy")),
    disputeUntil: toISO(pick(d, "disputeUntil") || pick(d, "deadlines.disputeUntil")),
    lastSignature: pick(d, "lastSignature") || pick(d, "last_sig") || pick(d, "tx.signature")
  };
}

/* ---------------------------------------
 * Main
 * ------------------------------------- */

(async () => {
  // Fetch a page of deals
  const query = { limit: LIMIT, cursor: CURSOR || undefined };
  const res = await get("/actions/deals", query);

  // Normalize response shape
  const items = Array.isArray(res) ? res : Array.isArray(res?.items) ? res.items : [];
  const nextCursor = res?.nextCursor ?? "";

  const rows = items.map(normalizeDeal);
  const csv = toCSV(rows, HEADERS);

  // Ensure folder exists then write
  await mkdir(dirname(OUT), { recursive: true }).catch(() => {});
  await writeFile(OUT, csv, "utf8");

  // Print a tiny summary for the console
  console.log(
    JSON.stringify(
      {
        ok: true,
        count: rows.length,
        out: OUT,
        nextCursor: nextCursor || undefined
      },
      null,
      2
    )
  );
})().catch(err => {
  console.error(JSON.stringify({ ok: false, error: String(err) }, null, 2));
  process.exit(1);
});
