import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { executePendingSchema, validateBody } from "@/lib/validation";
import {
  cancelPendingOrder,
  processPendingOrder,
  emergencyDisable,
  type PendingOrderRow,
} from "@/lib/execution/autoExecutor";

const db = prisma as unknown as {
  pendingOrder: {
    findMany: (args: unknown) => Promise<PendingOrderRow[]>;
  };
};

/**
 * GET /api/execution/pending
 * Returns all pending orders with countdown timers.
 */
export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const orders = await db.pendingOrder.findMany({
    where: {},
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();
  const enriched = orders.map((order) => ({
    ...order,
    secondsRemaining: Math.max(0, Math.round((new Date(order.cancelDeadline).getTime() - now) / 1000)),
    canCancel: order.status === "pending" && new Date(order.cancelDeadline).getTime() > now,
    canExecuteNow: order.status === "pending",
  }));

  return NextResponse.json({ orders: enriched });
}

/**
 * DELETE /api/execution/pending
 * Cancel a pending order.
 * Body: { orderId: number, reason?: string }
 */
export async function DELETE(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  const body = await req.json();
  const { orderId, reason } = body as { orderId?: number; reason?: string };

  if (!orderId || typeof orderId !== "number") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  const result = await cancelPendingOrder(orderId, reason);
  if (!result.success) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  return NextResponse.json({ success: true });
}

/**
 * POST /api/execution/pending
 * Execute a pending order immediately (skip remaining window).
 * Body: { orderId: number }
 */
export async function POST(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 3, 60_000);
  if (limited) return limited;

  const parsed = await validateBody(req, executePendingSchema);
  if (parsed.error) {
    return NextResponse.json({ error: parsed.error }, { status: parsed.status });
  }
  const { orderId, action } = parsed.data;

  // Emergency disable all
  if (action === "emergency_disable") {
    const result = await emergencyDisable();
    return NextResponse.json({ success: true, cancelled: result.cancelled });
  }

  if (!orderId || typeof orderId !== "number") {
    return NextResponse.json({ error: "orderId is required" }, { status: 400 });
  }

  // Fetch the order
  const orders = await db.pendingOrder.findMany({
    where: { id: orderId },
  });
  const order = orders[0];

  if (!order) {
    return NextResponse.json({ error: "Order not found" }, { status: 404 });
  }

  if (order.status !== "pending") {
    return NextResponse.json({ error: `Cannot execute — status is ${order.status}` }, { status: 409 });
  }

  // Process immediately (runs pre-flight + execution)
  try {
    await processPendingOrder(order);

    // Re-fetch to get updated status
    const updated = await db.pendingOrder.findMany({ where: { id: orderId } });
    return NextResponse.json({ success: true, order: updated[0] });
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: errMsg }, { status: 500 });
  }
}
