/**
 * Dry-run report: which DB tickers cannot be traded on Trading 212?
 *
 * Cross-references Ticker (active=true) against T212's live instrument
 * catalogue. Builds a Yahoo→T212 reverse map up front for O(1) lookup.
 * NO database changes.
 */
import "dotenv/config";
import { prisma } from "../src/db/client";
import { loadT212Settings, getInstruments, type T212Instrument } from "../src/lib/t212/client";

function t212ToYahoo(inst: T212Instrument): string {
  const short = inst.shortName;
  if (inst.currencyCode === "GBX" || inst.currencyCode === "GBP") return `${short}.L`;
  if (inst.currencyCode === "EUR" && inst.ticker.endsWith("l_EQ")) return `${short}.AS`;
  return short; // USD and fallback
}

async function main() {
  const db = prisma as unknown as {
    ticker: {
      findMany: (args: unknown) => Promise<Array<{ id: number; symbol: string; name: string | null; sector: string | null; active: boolean }>>;
    };
    trade: { findMany: (args: unknown) => Promise<Array<{ ticker: string; status: string }>> };
    pendingOrder: { findMany: (args: unknown) => Promise<Array<{ ticker: string; status: string }>> };
  };

  console.log("Loading T212 settings...");
  const settings = await loadT212Settings();
  if (!settings) {
    console.error("ERROR: T212 settings not configured");
    process.exit(1);
  }

  console.log("Fetching live T212 instrument catalogue...");
  const instruments = await getInstruments(settings);
  console.log(`  → ${instruments.length} T212 instruments returned\n`);

  console.log("Building Yahoo→T212 reverse map...");
  const yahooToT212 = new Map<string, T212Instrument>();
  for (const inst of instruments) {
    const yahoo = t212ToYahoo(inst);
    if (!yahooToT212.has(yahoo)) yahooToT212.set(yahoo, inst);
  }
  console.log(`  → ${yahooToT212.size} unique Yahoo tickers mapped\n`);

  console.log("Loading active tickers from DB...");
  const tickers = await db.ticker.findMany({ where: { active: true }, orderBy: { symbol: "asc" } });
  console.log(`  → ${tickers.length} active DB tickers\n`);

  const openTrades = await db.trade.findMany({ where: { status: "OPEN" }, select: { ticker: true, status: true } });
  const openTickerSet = new Set(openTrades.map((t) => t.ticker));

  const pending = await db.pendingOrder.findMany({
    where: { status: { in: ["NEW", "PENDING", "AWAITING_FILL"] } },
    select: { ticker: true, status: true },
  });
  const pendingTickerSet = new Set(pending.map((p) => p.ticker));

  const tradeable: string[] = [];
  const untradeable: Array<{
    symbol: string;
    name: string | null;
    sector: string | null;
    hasOpenTrade: boolean;
    hasPending: boolean;
  }> = [];

  for (const t of tickers) {
    if (yahooToT212.has(t.symbol)) {
      tradeable.push(t.symbol);
    } else {
      untradeable.push({
        symbol: t.symbol,
        name: t.name,
        sector: t.sector,
        hasOpenTrade: openTickerSet.has(t.symbol),
        hasPending: pendingTickerSet.has(t.symbol),
      });
    }
  }

  // Group by suffix
  const groups = new Map<string, typeof untradeable>();
  for (const u of untradeable) {
    const suffix = u.symbol.includes(".") ? u.symbol.slice(u.symbol.lastIndexOf(".")) : "(US/no-suffix)";
    if (!groups.has(suffix)) groups.set(suffix, []);
    groups.get(suffix)!.push(u);
  }

  console.log("═══════════════════════════════════════════════════════════════");
  console.log("                    REPORT — DRY RUN ONLY");
  console.log("═══════════════════════════════════════════════════════════════\n");
  console.log(`Total active DB tickers:  ${tickers.length}`);
  console.log(`  Tradeable on T212:      ${tradeable.length}`);
  console.log(`  NOT tradeable on T212:  ${untradeable.length}\n`);

  if (untradeable.length === 0) {
    console.log("✅ No untradeable tickers found. Nothing to remove.");
    await prisma.$disconnect();
    return;
  }

  console.log("─── Untradeable tickers, grouped by exchange suffix ───\n");
  const sortedSuffixes = Array.from(groups.keys()).sort();
  for (const suffix of sortedSuffixes) {
    const list = groups.get(suffix)!.sort((a, b) => a.symbol.localeCompare(b.symbol));
    console.log(`${suffix}  (${list.length})`);
    for (const u of list) {
      const flags: string[] = [];
      if (u.hasOpenTrade) flags.push("⚠️ OPEN TRADE");
      if (u.hasPending) flags.push("⚠️ PENDING");
      const flagStr = flags.length ? "  " + flags.join(" ") : "";
      const name = u.name ? ` — ${u.name}` : "";
      const sector = u.sector ? ` [${u.sector}]` : "";
      console.log(`  ${u.symbol.padEnd(12)}${name}${sector}${flagStr}`);
    }
    console.log("");
  }

  const blockers = untradeable.filter((u) => u.hasOpenTrade || u.hasPending);
  const safe = untradeable.filter((u) => !u.hasOpenTrade && !u.hasPending);

  if (blockers.length > 0) {
    console.log("⚠️  WARNING: These untradeable tickers have OPEN trades or PENDING orders.");
    console.log("    They will NOT be deactivated until those positions close.\n");
    for (const b of blockers) {
      const what: string[] = [];
      if (b.hasOpenTrade) what.push("open trade");
      if (b.hasPending) what.push("pending");
      console.log(`    ${b.symbol}  (${what.join(", ")})`);
    }
    console.log("");
  }

  console.log("─── SUMMARY ───");
  console.log(`Safe to deactivate now:        ${safe.length}`);
  console.log(`Blocked (open/pending):        ${blockers.length}`);
  console.log("");
  console.log("To execute deactivation: re-run with --apply  (not yet implemented).");

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
