import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";
import { loadUniverse } from "@/lib/hbme/loadUniverse";
import { scoreSectors } from "@/lib/hbme/sectorEngine";
import { findBreakouts } from "@/lib/hbme/breakoutEngine";
import { runAlertCheck } from "@/lib/hbme/alertEngine";
import { fetchEODQuotes } from "@/lib/data/fetchQuotes";
import { saveSectorResults, saveMomentumSignals, updateMomentumTrailingStops } from "@/lib/hbme/scanHelpers";
import { calculateMarketRegime } from "@/lib/signals/regimeFilter";
import { createLogger } from "@/lib/logger";
import type { Candle } from "@/lib/hbme/types";

const log = createLogger("momentum-scan");

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function POST(req: NextRequest) {
  // Middleware already authenticates browser requests via dashboard cookie.
  // This route is NOT in PUBLIC_PATHS, so any request that reaches here
  // has already passed middleware auth. No additional auth check needed
  // for browser callers.
  //
  // For programmatic/cron callers that bypass the browser (e.g. scheduled
  // tasks), the SCHEDULED_SCAN_TOKEN would be sent via Authorization header,
  // and the route would need to be added to PUBLIC_PATHS.

  if (!config.MOMENTUM_ENABLED) {
    return NextResponse.json({ error: "Momentum engine is disabled" }, { status: 400 });
  }

  const startTime = Date.now();
  let scanRunId: number | null = null;

  try {
    const scanRun = await prisma.scanRun.create({
      data: {
        startedAt: new Date(),
        status: "RUNNING",
        trigger: "MANUAL",
        market: "ALL",
        scanType: "momentum",
      },
    });
    scanRunId = scanRun.id;
    const t0 = Date.now();
    const regime = await calculateMarketRegime();
    const tRegime = Date.now() - t0;

    const t1 = Date.now();
    const universe = await loadUniverse();
    const tUniverse = Date.now() - t1;

    const tickers = universe.map((u) => u.ticker);

    const t2 = Date.now();
    const quoteMap = await fetchEODQuotes(tickers);
    const tQuotes = Date.now() - t2;

    const tickersWithData = Object.keys(quoteMap).length;

    const priceMap = new Map<string, Candle[]>();
    for (const [ticker, quotes] of Object.entries(quoteMap)) {
      priceMap.set(ticker, quotes.map((q) => ({
        date: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume,
      })));
    }

    const t3 = Date.now();
    const sectors = scoreSectors(universe, priceMap);
    await saveSectorResults(sectors, scanRun.id);

    const hotSectors = sectors.slice(0, 5).map((s) => s.sector);
    const { candidates, nearMisses } = findBreakouts(
      universe, priceMap, hotSectors, sectors,
    );
    await saveMomentumSignals(candidates, nearMisses, scanRun.id);
    const tEngines = Date.now() - t3;

    await updateMomentumTrailingStops();

    let alertCount = 0;
    try {
      const alerts = await runAlertCheck();
      alertCount = alerts.length;
    } catch {
      // alert check is best effort
    }

    const durationMs = Date.now() - startTime;
    await prisma.scanRun.update({
      where: { id: scanRunId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        tickersScanned: universe.length,
        signalsFound: candidates.length,
        durationMs,
        marketRegime: regime.marketRegime,
      },
    });

    return NextResponse.json({
      scanRunId,
      universeSize: universe.length,
      tickersWithData,
      tickersWithoutData: universe.length - tickersWithData,
      sectorsRanked: sectors.length,
      hotSectors,
      signalCount: candidates.length,
      nearMissCount: nearMisses.length,
      alertCount,
      durationMs,
      timing: {
        regimeMs: tRegime,
        universeMs: tUniverse,
        quotesMs: tQuotes,
        enginesMs: tEngines,
      },
      regime: {
        marketRegime: regime.marketRegime,
        volatilityRegime: regime.volatilityRegime,
        vixLevel: regime.vixLevel,
      },
    });
  } catch (err) {
    log.error({ err, scanRunId }, "Momentum scan failed");
    if (scanRunId) {
      await prisma.scanRun.update({
        where: { id: scanRunId },
        data: {
          status: "FAILED",
          completedAt: new Date(),
          error: String(err),
        },
      }).catch((updateErr) => log.error({ updateErr }, "Failed to update ScanRun status"));
    }
    return NextResponse.json(
      { error: "Momentum scan failed", detail: String(err) },
      { status: 500 },
    );
  }
}
