import { NextRequest, NextResponse } from "next/server";
import { handleToolCall } from "@/agent/tools";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";
import { createLogger } from "@/lib/logger";

const log = createLogger("api/agent/journal");

/**
 * POST /api/agent/journal
 * Internal endpoint that invokes the write_trade_journal tool handler directly
 * (no full agent loop). Called by the close route after a trade is closed.
 *
 * Body: { tradeId: string }
 */
export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 10, 60_000);
  if (limited) return limited;

  try {
    const body = (await req.json()) as Record<string, unknown>;
    const tradeId = body["tradeId"];

    if (typeof tradeId !== "string" || tradeId.length === 0) {
      return NextResponse.json(
        { error: "tradeId (string cuid) is required" },
        { status: 400 }
      );
    }

    const baseUrl =
      process.env["TRADECORE_BASE_URL"] ?? `http://localhost:${process.env["PORT"] ?? 3000}`;

    const result = await handleToolCall("write_trade_journal", { tradeId }, baseUrl);

    if (!result.success) {
      log.error({ tradeId, error: result.error }, "write_trade_journal failed");
      return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
    }

    log.info({ tradeId, data: result.data }, "Trade journal written");
    return NextResponse.json({ ok: true, ...(result.data as Record<string, unknown>) });
  } catch (err) {
    log.error({ err }, "Failed to write trade journal");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to write trade journal" },
      { status: 500 }
    );
  }
}
