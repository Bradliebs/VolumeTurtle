import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { config, applyDbSettings } from "@/lib/config";

const db = prisma as unknown as {
  appSettings: {
    findFirst: (args: { orderBy: { id: "asc" } }) => Promise<{
      id: number;
      momentumEnabled: boolean;
      breakoutMinChg: number;
      breakoutMinVol: number;
      scoreWeightRegime: number;
      scoreWeightBreakout: number;
      scoreWeightSector: number;
      scoreWeightLiquidity: number;
    } | null>;
    upsert: (args: unknown) => Promise<unknown>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const row = await db.appSettings.findFirst({ orderBy: { id: "asc" } });

  return NextResponse.json({
    momentumEnabled: row?.momentumEnabled ?? config.MOMENTUM_ENABLED,
    breakoutMinChg: row?.breakoutMinChg ?? config.BREAKOUT_MIN_CHG,
    breakoutMinVol: row?.breakoutMinVol ?? config.BREAKOUT_MIN_VOL,
    scoreWeightRegime: row?.scoreWeightRegime ?? config.SCORE_WEIGHT_REGIME,
    scoreWeightBreakout: row?.scoreWeightBreakout ?? config.SCORE_WEIGHT_BREAKOUT,
    scoreWeightSector: row?.scoreWeightSector ?? config.SCORE_WEIGHT_SECTOR,
    scoreWeightLiquidity: row?.scoreWeightLiquidity ?? config.SCORE_WEIGHT_LIQUIDITY,
  });
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  const body = await req.json();
  const {
    momentumEnabled,
    breakoutMinChg,
    breakoutMinVol,
    scoreWeightRegime,
    scoreWeightBreakout,
    scoreWeightSector,
    scoreWeightLiquidity,
  } = body as {
    momentumEnabled?: boolean;
    breakoutMinChg?: number;
    breakoutMinVol?: number;
    scoreWeightRegime?: number;
    scoreWeightBreakout?: number;
    scoreWeightSector?: number;
    scoreWeightLiquidity?: number;
  };

  // Validate weights sum to ~1.0 if all four provided
  if (
    scoreWeightRegime != null &&
    scoreWeightBreakout != null &&
    scoreWeightSector != null &&
    scoreWeightLiquidity != null
  ) {
    const sum = scoreWeightRegime + scoreWeightBreakout + scoreWeightSector + scoreWeightLiquidity;
    if (Math.abs(sum - 1.0) > 0.02) {
      return NextResponse.json(
        { error: `Weights must sum to 1.0 (got ${sum.toFixed(3)})` },
        { status: 400 },
      );
    }
  }

  await db.appSettings.upsert({
    where: { id: 1 },
    create: {
      momentumEnabled: momentumEnabled ?? true,
      breakoutMinChg: breakoutMinChg ?? 0.10,
      breakoutMinVol: breakoutMinVol ?? 3.0,
      scoreWeightRegime: scoreWeightRegime ?? 0.35,
      scoreWeightBreakout: scoreWeightBreakout ?? 0.30,
      scoreWeightSector: scoreWeightSector ?? 0.25,
      scoreWeightLiquidity: scoreWeightLiquidity ?? 0.10,
    },
    update: {
      ...(momentumEnabled != null && { momentumEnabled }),
      ...(breakoutMinChg != null && { breakoutMinChg }),
      ...(breakoutMinVol != null && { breakoutMinVol }),
      ...(scoreWeightRegime != null && { scoreWeightRegime }),
      ...(scoreWeightBreakout != null && { scoreWeightBreakout }),
      ...(scoreWeightSector != null && { scoreWeightSector }),
      ...(scoreWeightLiquidity != null && { scoreWeightLiquidity }),
    },
  });

  // Patch in-memory config so subsequent calls pick it up immediately
  await applyDbSettings();

  return NextResponse.json({ saved: true });
}
