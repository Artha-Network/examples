#!/usr/bin/env node

/**
 * Deal Health Checker
 *
 * Fetches active deals and flags potential issues:
 *   - Deals stuck in INIT for too long (never funded)
 *   - Funded deals approaching dispute deadline
 *   - Disputes with no evidence submitted
 *   - Deals older than the timeout period
 *
 * Usage:
 *   node scripts/check_deal_health.mjs
 *   node scripts/check_deal_health.mjs --base-url http://localhost:4000
 *   node scripts/check_deal_health.mjs --verbose
 */

const BASE_URL = process.env.ARTHA_BASE_URL
  || process.argv.find((a) => a.startsWith("--base-url="))?.split("=")[1]
  || "http://localhost:4000";
const VERBOSE = process.argv.includes("--verbose");

// Thresholds
const STALE_INIT_HOURS = 24;       // INIT deals older than this are flagged
const DEADLINE_WARNING_HOURS = 12;  // Warn if dispute window closes within this
const DEAL_TIMEOUT_DAYS = 30;

const COLORS = {
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  reset: "\x1b[0m",
};

async function fetchJSON(path) {
  const res = await fetch(`${BASE_URL}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} — ${path}`);
  return res.json();
}

function hoursAgo(isoDate) {
  return (Date.now() - new Date(isoDate).getTime()) / (1000 * 60 * 60);
}

function formatAge(hours) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

async function main() {
  const c = COLORS;
  console.log(`\n${c.bold}${c.cyan}Deal Health Report${c.reset}  ${c.dim}${new Date().toISOString()}${c.reset}`);
  console.log(`${c.dim}Server: ${BASE_URL}${c.reset}\n`);

  let deals;
  try {
    const data = await fetchJSON("/api/deals");
    deals = data.deals || data;
  } catch (err) {
    console.error(`${c.red}Failed to fetch deals: ${err.message}${c.reset}`);
    process.exit(1);
  }

  if (!Array.isArray(deals) || deals.length === 0) {
    console.log(`${c.dim}No deals found.${c.reset}\n`);
    return;
  }

  const issues = [];
  const stats = { total: deals.length, healthy: 0, warning: 0, critical: 0 };

  for (const deal of deals) {
    const age = hoursAgo(deal.createdAt || deal.created_at);
    const id = (deal.id || deal.dealId || "unknown").slice(0, 8);
    const status = deal.status || "UNKNOWN";
    const dealIssues = [];

    // Check: INIT too long (never funded)
    if (status === "INIT" && age > STALE_INIT_HOURS) {
      dealIssues.push({
        level: "warning",
        msg: `Stuck in INIT for ${formatAge(age)} (threshold: ${STALE_INIT_HOURS}h)`,
      });
    }

    // Check: deal timeout
    if (age > DEAL_TIMEOUT_DAYS * 24 && !["RELEASED", "REFUNDED", "RESOLVED"].includes(status)) {
      dealIssues.push({
        level: "critical",
        msg: `Deal age ${formatAge(age)} exceeds ${DEAL_TIMEOUT_DAYS}-day timeout`,
      });
    }

    // Check: funded deal nearing dispute deadline
    if (status === "FUNDED" && deal.disputeBy) {
      const hoursLeft = (new Date(deal.disputeBy).getTime() - Date.now()) / (1000 * 60 * 60);
      if (hoursLeft < 0) {
        dealIssues.push({
          level: "critical",
          msg: `Dispute window expired ${formatAge(Math.abs(hoursLeft))} ago`,
        });
      } else if (hoursLeft < DEADLINE_WARNING_HOURS) {
        dealIssues.push({
          level: "warning",
          msg: `Dispute window closing in ${formatAge(hoursLeft)}`,
        });
      }
    }

    // Check: dispute with no evidence
    if (status === "DISPUTED" && deal.evidenceCount === 0) {
      dealIssues.push({
        level: "warning",
        msg: "Dispute opened but no evidence submitted yet",
      });
    }

    if (dealIssues.length === 0) {
      stats.healthy++;
      if (VERBOSE) {
        console.log(`  ${c.green}\u2713${c.reset} ${id}  ${c.dim}${status} (${formatAge(age)})${c.reset}`);
      }
    } else {
      for (const issue of dealIssues) {
        if (issue.level === "critical") stats.critical++;
        else stats.warning++;

        const icon = issue.level === "critical" ? `${c.red}\u2717` : `${c.yellow}\u26A0`;
        console.log(`  ${icon}${c.reset} ${id}  ${status}  ${issue.msg}`);
        issues.push({ dealId: id, ...issue });
      }
    }
  }

  // Summary
  console.log(`\n${c.bold}Summary${c.reset}`);
  console.log(`  Total deals:  ${stats.total}`);
  console.log(`  ${c.green}Healthy:    ${stats.healthy}${c.reset}`);
  if (stats.warning) console.log(`  ${c.yellow}Warnings:   ${stats.warning}${c.reset}`);
  if (stats.critical) console.log(`  ${c.red}Critical:   ${stats.critical}${c.reset}`);
  console.log();

  process.exit(stats.critical > 0 ? 2 : stats.warning > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`Unexpected error: ${err.message}`);
  process.exit(1);
});
