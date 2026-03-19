import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { updateBalanceSchema, validateBody } from "@/lib/validation";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/balance");

export async function PATCH(request: NextRequest) {
  try {
    const parsed = await validateBody(request, updateBalanceSchema);
    if (parsed.error) {
      return NextResponse.json({ error: parsed.error }, { status: parsed.status });
    }
    const { balance } = parsed.data;

    const latest = await prisma.accountSnapshot.findFirst({
      orderBy: { date: "desc" },
    });

    const snapshot = await prisma.accountSnapshot.create({
      data: {
        date: new Date(),
        balance,
        openTrades: latest?.openTrades ?? 0,
      },
    });

    return NextResponse.json(snapshot);
  } catch (err) {
    log.error({ err }, "Failed to update balance");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update balance" },
      { status: 500 },
    );
  }
}
