import { prisma } from "@/db/client";
import type { AgentContext } from "./context";

const db = prisma as unknown as {
  agentDecisionLog: {
    create: (args: unknown) => Promise<unknown>;
  };
};

export interface CycleAction {
  toolName: string;
  toolInput: Record<string, unknown>;
  result: { success: boolean; data?: unknown; error?: string };
  durationMs: number;
}

export interface CycleLogPayload {
  cycleId: string;
  cycleStartedAt: Date;
  context: AgentContext;
  reasoning: string;
  actions: CycleAction[];
  telegramSent: boolean;
  totalDurationMs: number;
  errorMessage?: string;
}

export async function logCycle(payload: CycleLogPayload): Promise<void> {
  try {
    await db.agentDecisionLog.create({
      data: {
        cycleId: payload.cycleId,
        cycleStartedAt: payload.cycleStartedAt,
        contextJson: payload.context as unknown,
        reasoning: payload.reasoning,
        actionsJson: JSON.stringify(payload.actions),
        outcomeJson: JSON.stringify(
          payload.actions.map((a) => ({
            tool: a.toolName,
            success: a.result.success,
            error: a.result.error ?? null,
          }))
        ),
        telegramSent: payload.telegramSent,
        durationMs: payload.totalDurationMs,
        errorMessage: payload.errorMessage ?? null,
      },
    } as unknown);
  } catch (err) {
    console.error("[AgentLogger] Failed to write decision log:", err);
  }
}
