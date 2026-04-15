import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { config } from "@/lib/config";
import { calculateEquityCurveState } from "@/lib/risk/equityCurve";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const entry = parseFloat(url.searchParams.get("entry") ?? "0");
  const stop = parseFloat(url.searchParams.get("stop") ?? "0");

  if (entry <= 0 || stop <= 0 || stop >= entry) {
    return NextResponse.json({ error: "Invalid entry/stop" }, { status: 400 });
  }

  const results = await prisma.accountSnapshot.findMany({ orderBy: { date: "desc" }, take: 1 });
  const balance = results[0]?.balance ?? config.balance;

  const allSnapshots = await prisma.accountSnapshot.findMany({ orderBy: { date: "asc" } });
  const equityCurve = calculateEquityCurveState(allSnapshots, config.riskPctPerTrade * 100, config.maxPositions);

  const effectiveRiskPct = equityCurve.riskPctPerTrade / 100;
  const riskPerShare = entry - stop;
  const dollarRisk = balance * effectiveRiskPct;
  const shares = Math.round((dollarRisk / riskPerShare) * 10000) / 10000;
  const totalExposure = shares * entry;
  const exposurePct = (totalExposure / balance) * 100;

  return NextResponse.json({
    balance,
    shares,
    dollarRisk,
    riskPct: equityCurve.riskPctPerTrade,
    totalExposure,
    exposurePct,
    systemState: equityCurve.systemState,
    reason: equityCurve.reason,
  });
}
