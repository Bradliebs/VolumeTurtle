import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import {
  processPendingOrder,
  type PendingOrderRow,
} from "@/lib/execution/autoExecutor";

const db = prisma as unknown as {
  pendingOrder: {
    findUnique: (args: unknown) => Promise<PendingOrderRow | null>;
  };
};

/**
 * POST /api/execution/execute
 * Executes a specific PendingOrder through the full pre-flight + T212 flow.
 * Used by the autonomous agent to trigger order execution.
 */
export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const pendingOrderId = body["pendingOrderId"];

    if (typeof pendingOrderId !== "number") {
      return NextResponse.json(
        { error: "pendingOrderId (number) is required" },
        { status: 400 },
      );
    }

    const order = await db.pendingOrder.findUnique({
      where: { id: pendingOrderId },
    } as unknown);

    if (!order) {
      return NextResponse.json(
        { error: `PendingOrder ${pendingOrderId} not found` },
        { status: 404 },
      );
    }

    if (order.status !== "pending") {
      return NextResponse.json(
        { error: `Order status is '${order.status}', not 'pending'` },
        { status: 409 },
      );
    }

    await processPendingOrder(order);

    // Re-fetch to get updated status after processing
    const updated = await db.pendingOrder.findUnique({
      where: { id: pendingOrderId },
    } as unknown);

    return NextResponse.json({
      ok: true,
      orderId: pendingOrderId,
      status: updated?.status ?? "unknown",
      agentReasoning: body["agentReasoning"] ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
