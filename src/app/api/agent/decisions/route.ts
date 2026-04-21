import { NextResponse } from "next/server";
import { prisma } from "@/db/client";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const db = prisma as unknown as {
  agentDecisionLog: {
    findMany: (args: unknown) => Promise<Array<{
      id: number;
      cycleId: string;
      cycleStartedAt: Date;
      createdAt: Date;
      reasoning: string;
      actionsJson: string;
      telegramSent: boolean;
      durationMs: number;
      errorMessage: string | null;
    }>>;
  };
};

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  const url = new URL(req.url);
  const executionsOnly = url.searchParams.get("executionsOnly") === "1";

  const rows = await db.agentDecisionLog.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
  } as unknown);

  const decisions = rows
    .map((r) => {
      let actions: Array<Record<string, unknown>> = [];
      try {
        const parsed = JSON.parse(r.actionsJson) as unknown;
        if (Array.isArray(parsed)) actions = parsed as Array<Record<string, unknown>>;
      } catch { /* keep [] */ }
      const toolNames = actions.map((a) => String(a["toolName"] ?? "")).filter(Boolean);
      return {
        id: r.id,
        cycleId: r.cycleId,
        cycleStartedAt: r.cycleStartedAt.toISOString(),
        createdAt: r.createdAt.toISOString(),
        durationMs: r.durationMs,
        toolCount: actions.length,
        toolNames,
        hasExecution: toolNames.includes("execute_signal"),
        telegramSent: r.telegramSent,
        errorMessage: r.errorMessage,
        reasoning: r.reasoning,
      };
    })
    .filter((d) => (executionsOnly ? d.hasExecution : true));

  return NextResponse.json({ decisions });
}
