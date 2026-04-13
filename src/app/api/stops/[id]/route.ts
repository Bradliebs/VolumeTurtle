import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { createLogger } from "@/lib/logger";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const log = createLogger("api/stops");

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const rlResponse = rateLimit(getRateLimitKey(request), 10, 60_000);
  if (rlResponse) return rlResponse;

  try {
    const { id } = await params;
    const updated = await prisma.stopHistory.update({
      where: { id },
      data: { actioned: true, actionedAt: new Date() },
    });
    return NextResponse.json(updated);
  } catch (err) {
    log.error({ err }, "Failed to mark stop actioned");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to update" },
      { status: 500 },
    );
  }
}
