import { TOOL_DEFINITIONS, handleToolCall } from "./tools";
import type { CycleAction } from "./logger";
import type { AgentContext } from "./context";
import { buildSystemPrompt } from "./prompt";
import { config } from "@/lib/config";

const MAX_ITERATIONS = 12;

// Defaults matching AiSettings seed — will be overridden if a DB read is wired later
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const DEFAULT_MAX_TOKENS = 2048;

export interface ExecutorResult {
  reasoning: string;
  actions: CycleAction[];
  telegramSent: boolean;
  error?: string;
}

export async function runAgentCycle(
  context: AgentContext,
  baseUrl: string,
  systemPrompt?: string
): Promise<ExecutorResult> {
  const actions: CycleAction[] = [];
  let reasoning = "";
  let telegramSent = false;

  const userMessage = buildContextMessage(context);

  const messages: Array<{ role: string; content: unknown }> = [
    { role: "user", content: userMessage },
  ];

  let iterations = 0;

  while (iterations < MAX_ITERATIONS) {
    iterations++;

    const requestBody = JSON.stringify({
      model: DEFAULT_MODEL,
      max_tokens: DEFAULT_MAX_TOKENS,
      system: systemPrompt ?? buildSystemPrompt(),
      tools: TOOL_DEFINITIONS,
      messages,
    });

    // Token estimate warning — rough heuristic: 1 token ≈ 4 chars
    if (iterations === 1) {
      const estTokens = Math.ceil(requestBody.length / 4);
      if (estTokens > 6000) {
        console.warn(`[AgentExecutor] High token estimate: ~${estTokens} tokens (${requestBody.length} chars). Risk of rate-limit hit.`);
      }
    }

    const fetchClaude = async (): Promise<Response> => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      try {
        return await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": config.ANTHROPIC_API_KEY,
          },
          body: requestBody,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeout);
      }
    };

    let response: Response;
    try {
      response = await fetchClaude();
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("Claude API timed out after 30 seconds");
      }
      throw err;
    }

    // Retry once on transient errors (429 rate limit or 5xx server error)
    if (response.status === 429 || response.status >= 500) {
      // Rate limit is per minute — wait 60s for the window to reset
      const waitSec = response.status === 429 ? 60 : 10;
      console.warn(`[AgentExecutor] Claude API returned ${response.status} — retrying in ${waitSec}s…`);
      await new Promise((r) => setTimeout(r, waitSec * 1000));
      try {
        response = await fetchClaude();
      } catch (retryErr) {
        if (retryErr instanceof Error && retryErr.name === "AbortError") {
          throw new Error("Claude API timed out after 30 seconds (retry attempt)");
        }
        throw retryErr;
      }
      if (!response.ok) {
        const errText = await response.text();
        throw new Error(`Claude API error ${response.status} after retry: ${errText}`);
      }
    } else if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Claude API error ${response.status}: ${errText}`);
    }

    const data = (await response.json()) as {
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason: string;
    };

    const textBlocks = data.content
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join("\n");

    if (textBlocks) {
      reasoning += (reasoning ? "\n\n" : "") + textBlocks;
    }

    if (data.stop_reason === "end_turn") break;
    if (data.stop_reason !== "tool_use") break;

    const toolUseBlocks = data.content.filter((b) => b.type === "tool_use");

    messages.push({ role: "assistant", content: data.content });

    const toolResultContent: Array<{
      type: string;
      tool_use_id: string;
      content: string;
    }> = [];

    for (const toolCall of toolUseBlocks) {
      const toolStart = Date.now();
      const result = await handleToolCall(
        toolCall.name ?? "",
        toolCall.input ?? {},
        baseUrl,
        context.cycleId
      );
      const durationMs = Date.now() - toolStart;

      actions.push({
        toolName: toolCall.name ?? "",
        toolInput: toolCall.input ?? {},
        result,
        durationMs,
      });

      if (toolCall.name === "send_telegram_summary" && result.success) {
        telegramSent = true;
      }

      if (!toolCall.id) {
        console.warn(`[AgentExecutor] Tool call '${toolCall.name}' has no ID — skipping tool result to avoid breaking Claude's agentic loop`);
        continue;
      }

      toolResultContent.push({
        type: "tool_result",
        tool_use_id: toolCall.id,
        content: result.success
          ? JSON.stringify(result.data ?? { ok: true })
          : JSON.stringify({ error: result.error }),
      });
    }

    messages.push({ role: "user", content: toolResultContent });

    const lastTool = toolUseBlocks[toolUseBlocks.length - 1];
    if (lastTool?.name === "send_telegram_summary") break;
  }

  if (iterations >= MAX_ITERATIONS) {
    console.warn(
      `[AgentExecutor] Hit MAX_ITERATIONS (${MAX_ITERATIONS}) — forcing exit.`
    );
  }

  return { reasoning, actions, telegramSent };
}

function buildContextMessage(ctx: AgentContext): string {
  const lines: string[] = [];

  lines.push(`AGENT CYCLE — ${ctx.timestamp}`);
  lines.push("═".repeat(50));

  if (ctx.haltFlag.halted) {
    lines.push(
      `\n🛑 HALT FLAG ACTIVE: ${ctx.haltFlag.reason ?? "No reason given"}`
    );
    lines.push("Do not execute any orders. Ratchet stops only.");
  }

  if (ctx.consecutiveFailures >= 2) {
    lines.push(
      `\n⚠️ CONSECUTIVE FAILURES: ${ctx.consecutiveFailures} cycles in a row have failed. Mention this in your Telegram summary so the user knows the system is degraded.`
    );
  }

  if (ctx.account) {
    lines.push(`\nACCOUNT`);
    lines.push(`  Equity: £${ctx.account.equity.toFixed(2)}`);
    lines.push(`  Cash:   £${ctx.account.cash.toFixed(2)}`);
    lines.push(`  As of:  ${ctx.account.snapshotAt}`);
  } else {
    lines.push("\n⚠ No account snapshot available.");
  }

  lines.push(`\nRISK BUDGET`);
  lines.push(
    `  Open positions:  ${ctx.riskBudget.openPositions} / ${ctx.riskBudget.maxPositions}`
  );
  lines.push(`  Slots available: ${ctx.riskBudget.slotsAvailable}`);
  lines.push(`  Current heat:    ${ctx.riskBudget.currentHeatPct}%`);
  lines.push(`  Heat cap:        ${ctx.riskBudget.heatCapPct}%`);
  lines.push(`  Heat remaining:  ${ctx.riskBudget.heatCapacityRemaining}%`);
  lines.push(
    `  Regime:          ${ctx.riskBudget.regimeBullish ? "BULL ✓" : "BEAR ✗"}`
  );
  lines.push(`  Drawdown state:  ${ctx.settings.drawdownState}`);

  lines.push(`\nOPEN POSITIONS (${ctx.openPositions.length})`);
  if (ctx.openPositions.length === 0) {
    lines.push("  None");
  } else {
    for (const p of ctx.openPositions) {
      const pnlR = p.pnlR != null ? `${p.pnlR >= 0 ? "+" : ""}${p.pnlR.toFixed(2)}R` : "—";
      lines.push(
        `  [${p.id}] ${p.ticker} | Entry: ${p.entryPrice} | Stop: ${p.currentStop} | Risk: ${p.riskPct}% | ${p.daysOpen}d | P&L: ${pnlR} | Grade: ${p.compositeGrade ?? "?"}`
      );
    }
  }

  lines.push(`\nPENDING SIGNALS (${ctx.pendingSignals.length})`);
  if (ctx.pendingSignals.length === 0) {
    lines.push("  None");
  } else {
    for (const s of ctx.pendingSignals) {
      const tag = s.convergence ? " | CONV" : "";
      lines.push(
        `  [${s.id}] ${s.ticker} | ${s.grade} | ${s.compositeScore.toFixed(2)} | ${s.entryPrice} | ${s.stopPrice} | ${s.engine}${tag}`
      );
    }
  }

  lines.push(`\nSETTINGS`);
  lines.push(
    `  Auto-execution: ${ctx.settings.autoExecutionEnabled ? "ON" : "OFF"}`
  );
  lines.push(`  Min grade:      ${ctx.settings.autoExecutionMinGrade}`);
  lines.push(`  Max per sector: ${ctx.settings.maxPositionsPerSector}`);

  lines.push(
    `\nLAST CYCLE: ${ctx.recentActivity.lastCycleAt ?? "Never"}`
  );
  lines.push(`RATCHETS THIS HOUR: ${ctx.recentActivity.ratchetsThisCycle}`);

  lines.push("\n" + "═".repeat(50));
  lines.push(
    "Now execute your decision framework. Call tools in the correct order."
  );

  return lines.join("\n");
}
