import { NextResponse } from "next/server";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { runBacktestEndToEnd } from "@/lib/backtest";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/backtest/run");

interface RunBody {
  start?: string;
  end?: string;
  capital?: number;
  riskPctPerTrade?: number;
  maxOpenPositions?: number;
  commissionPerTrade?: number;
  slippageBps?: number;
  spreadBps?: number;
  useSnapshots?: boolean;
  label?: string;
  convictionMultipliers?: { A?: number; B?: number; C?: number; D?: number };
  portfolioHeatCapPct?: number;
  maxPositionsPerSector?: number;
}

function isYmd(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export async function POST(req: Request) {
  // Backtests are CPU-heavy — much tighter rate limit than read endpoints.
  const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
  if (limited) return limited;

  let body: RunBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!isYmd(body.start) || !isYmd(body.end)) {
    return NextResponse.json(
      { error: "start and end must be YYYY-MM-DD strings" },
      { status: 400 },
    );
  }
  if (body.start > body.end) {
    return NextResponse.json({ error: "start must be <= end" }, { status: 400 });
  }
  const capital = body.capital ?? 10000;
  if (!Number.isFinite(capital) || capital <= 0) {
    return NextResponse.json({ error: "capital must be positive" }, { status: 400 });
  }

  // Run synchronously — typical 2-year window completes in 5–30s on cached data.
  // The route is rate-limited to 3/min so blocking here is acceptable.
  try {
    const t0 = Date.now();
    const out = await runBacktestEndToEnd({
      start: body.start,
      end: body.end,
      capital,
      ...(body.riskPctPerTrade !== undefined ? { riskPctPerTrade: body.riskPctPerTrade } : {}),
      ...(body.maxOpenPositions !== undefined ? { maxOpenPositions: body.maxOpenPositions } : {}),
      ...(body.commissionPerTrade !== undefined ? { commissionPerTrade: body.commissionPerTrade } : {}),
      ...(body.slippageBps !== undefined ? { slippageBps: body.slippageBps } : {}),
      ...(body.spreadBps !== undefined ? { spreadBps: body.spreadBps } : {}),
      ...(body.useSnapshots !== undefined ? { useSnapshots: body.useSnapshots } : {}),
      ...(body.convictionMultipliers !== undefined ? { convictionMultipliers: body.convictionMultipliers } : {}),
      ...(body.portfolioHeatCapPct !== undefined ? { portfolioHeatCapPct: body.portfolioHeatCapPct } : {}),
      ...(body.maxPositionsPerSector !== undefined ? { maxPositionsPerSector: body.maxPositionsPerSector } : {}),
      ...(body.label !== undefined ? { label: body.label } : {}),
    });
    const elapsedMs = Date.now() - t0;

    log.info({ runId: out.runId, universeSize: out.universeSize, elapsedMs }, "Backtest complete");

    return NextResponse.json({
      runId: out.runId,
      universeSize: out.universeSize,
      elapsedMs,
      summary: out.result.summary,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg }, "Backtest failed");
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
