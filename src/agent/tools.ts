import { prisma } from "@/db/client";
import { execSync } from "child_process";
import { readFileSync } from "fs";
import { resolve } from "path";
import { randomUUID } from "crypto";
import { DEFAULT_MODEL } from "./executor";

const DASHBOARD_TOKEN = process.env["DASHBOARD_TOKEN"] ?? "";

if (!DASHBOARD_TOKEN) {
  console.error("[agent/tools] DASHBOARD_TOKEN is not set — all internal API calls will fail with 401. Set it in .env.");
}

function agentHeaders(): Record<string, string> {
  return {
    "Content-Type": "application/json",
    "x-agent-call": "true",
    "Authorization": `Bearer ${DASHBOARD_TOKEN}`,
  };
}

const db = prisma as unknown as {
  agentHaltFlag: { upsert: (args: unknown) => Promise<unknown> };
  pendingOrder: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
  trade: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
};

export const TOOL_DEFINITIONS = [
  {
    name: "ratchet_stops",
    description:
      "Calls the cruise control ratchet for all open positions. Stops only move up. Always call this first in every cycle.",
    input_schema: {
      type: "object" as const,
      properties: {
        dryRun: {
          type: "boolean" as const,
          description: "If true, calculate but do not push to T212.",
        },
      },
      required: [] as string[],
    },
  },
  {
    name: "execute_signal",
    description:
      "Executes a pending signal: places a market order via T212 and sets the initial stop. Only call if ALL hard constraints are satisfied — grade B or above, slots available, heat under cap, regime bullish, no halt active.",
    input_schema: {
      type: "object" as const,
      properties: {
        pendingOrderId: {
          type: "number" as const,
          description: "The ID of the PendingOrder to execute.",
        },
        reasoning: {
          type: "string" as const,
          description: "Your reasoning for this execution. Stored in audit log.",
        },
      },
      required: ["pendingOrderId", "reasoning"],
    },
  },
  {
    name: "close_position",
    description:
      "Closes an open position via T212 market sell. Only call if instructed by a HALT or CLOSE command, or a critical risk check has failed.",
    input_schema: {
      type: "object" as const,
      properties: {
        tradeId: {
          type: "number" as const,
          description: "The Trade ID to close.",
        },
        reasoning: {
          type: "string" as const,
          description: "Reason for closing. Stored in audit log.",
        },
      },
      required: ["tradeId", "reasoning"],
    },
  },
  {
    name: "set_halt",
    description:
      "Sets or clears the agent halt flag. When halted, the agent skips all execution next cycle.",
    input_schema: {
      type: "object" as const,
      properties: {
        halted: {
          type: "boolean" as const,
          description: "True to halt, false to resume.",
        },
        reason: {
          type: "string" as const,
          description: "Reason for halting.",
        },
      },
      required: ["halted", "reason"],
    },
  },
  {
    name: "send_telegram_summary",
    description:
      "Sends the cycle summary to Telegram. Always call this last, even if no actions were taken.",
    input_schema: {
      type: "object" as const,
      properties: {
        summary: {
          type: "string" as const,
          description: "The cycle summary to send. Plain text with emoji, no markdown.",
        },
      },
      required: ["summary"],
    },
  },
  {
    name: "run_universe_snapshot",
    description:
      "Triggers the weekly universe snapshot. Call this on Sundays at 18:00 before auto-tune runs.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "run_autotune",
    description:
      "Runs the auto-tune pipeline and returns the full recommendation JSON. Call this on Sundays at 19:00 after the universe snapshot.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "verify_ticker",
    description:
      "Verifies that a ticker symbol from a PendingOrder is tradeable on T212 before executing. Call this before every execute_signal call. Returns whether the ticker is valid on T212, the correct T212 instrument code if it differs from the Yahoo symbol, and whether the instrument is currently tradeable.",
    input_schema: {
      type: "object" as const,
      properties: {
        ticker: {
          type: "string" as const,
          description: "The Yahoo Finance symbol from the PendingOrder.",
        },
        pendingOrderId: {
          type: "number" as const,
          description: "The PendingOrder ID being checked.",
        },
      },
      required: ["ticker", "pendingOrderId"],
    },
  },
  {
    name: "check_t212_connection",
    description:
      "Checks whether the T212 API is reachable and authenticated. Call this at the start of every cycle, before ratchet_stops. If T212 is down, call set_halt immediately with reason 'T212 API unreachable' and skip all execution.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "check_premarket_risk",
    description:
      "Checks for upcoming binary events (earnings, FDA decisions, major news) for a list of tickers. Call this for any ticker before executing a signal, and for all open positions at the start of each cycle. Returns a risk assessment per ticker.",
    input_schema: {
      type: "object" as const,
      properties: {
        tickers: {
          type: "array" as const,
          items: { type: "string" as const },
          description: "List of Yahoo Finance ticker symbols to check.",
        },
      },
      required: ["tickers"],
    },
  },
  {
    name: "flag_position_health",
    description:
      "Flags a position health concern to the audit log and includes it in the Telegram summary. Does not close positions — only flags. Call this during the ratchet step if a position shows concerning characteristics.",
    input_schema: {
      type: "object" as const,
      properties: {
        tradeId: {
          type: "number" as const,
          description: "The Trade ID to flag.",
        },
        concern: {
          type: "string" as const,
          description: "Plain English description of the concern.",
        },
        severity: {
          type: "string" as const,
          enum: ["WATCH", "CONCERN", "URGENT"],
          description: "Severity level: WATCH, CONCERN, or URGENT.",
        },
      },
      required: ["tradeId", "concern", "severity"],
    },
  },
  {
    name: "check_equity_curve",
    description:
      "Analyses the recent equity curve for deterioration trends. Call this once per cycle after the T212 connection check. Returns the current drawdown from peak, the trend over the last 5 and 10 days, and a warning level.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "get_weekly_summary",
    description:
      "Queries the database for this week's trading activity and agent decisions. Returns structured data for the weekly debrief. Call this once at the start of the Friday debrief cycle.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
];

export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

export async function handleToolCall(
  toolName: string,
  toolInput: Record<string, unknown>,
  baseUrl: string
): Promise<ToolResult> {
  try {
    switch (toolName) {
      case "ratchet_stops":
        return await handleRatchetStops(toolInput, baseUrl);
      case "execute_signal":
        return await handleExecuteSignal(toolInput, baseUrl);
      case "close_position":
        return await handleClosePosition(toolInput, baseUrl);
      case "set_halt":
        return await handleSetHalt(toolInput);
      case "send_telegram_summary":
        return await handleSendTelegramSummary(toolInput, baseUrl);
      case "run_universe_snapshot":
        return handleRunUniverseSnapshot();
      case "run_autotune":
        return handleRunAutotune();
      case "verify_ticker":
        return await handleVerifyTicker(toolInput);
      case "check_t212_connection":
        return await handleCheckT212Connection();
      case "check_premarket_risk":
        return await handleCheckPremarketRisk(toolInput);
      case "flag_position_health":
        return await handleFlagPositionHealth(toolInput);
      case "check_equity_curve":
        return await handleCheckEquityCurve();
      case "get_weekly_summary":
        return await handleGetWeeklySummary();
      default:
        return { success: false, error: `Unknown tool: ${toolName}` };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: message };
  }
}

async function handleRatchetStops(
  input: Record<string, unknown>,
  baseUrl: string
): Promise<ToolResult> {
  const res = await fetch(`${baseUrl}/api/cruise-control/ratchet`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ dryRun: input["dryRun"] ?? false }),
  });
  if (!res.ok) {
    return { success: false, error: `Ratchet API error ${res.status}` };
  }
  const data: unknown = await res.json();
  return { success: true, data };
}

async function handleExecuteSignal(
  input: Record<string, unknown>,
  baseUrl: string
): Promise<ToolResult> {
  const order = await db.pendingOrder.findUnique({
    where: { id: input["pendingOrderId"] },
  } as unknown);
  if (!order) {
    return { success: false, error: `PendingOrder ${String(input["pendingOrderId"])} not found.` };
  }
  if (order["status"] !== "PENDING") {
    return { success: false, error: `Order is not PENDING — skipping.` };
  }
  const res = await fetch(`${baseUrl}/api/execution/execute`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({
      pendingOrderId: input["pendingOrderId"],
      agentReasoning: input["reasoning"],
    }),
  });
  if (!res.ok) {
    return { success: false, error: `Execution API error ${res.status}` };
  }
  const data: unknown = await res.json();
  return { success: true, data };
}

async function handleClosePosition(
  input: Record<string, unknown>,
  baseUrl: string
): Promise<ToolResult> {
  const trade = await db.trade.findUnique({
    where: { id: input["tradeId"] },
  } as unknown);
  if (!trade) {
    return { success: false, error: `Trade ${String(input["tradeId"])} not found.` };
  }
  if (trade["status"] !== "OPEN") {
    return { success: false, error: `Trade ${String(input["tradeId"])} is not OPEN.` };
  }
  const res = await fetch(`${baseUrl}/api/trades/${String(input["tradeId"])}/close`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ agentReasoning: input["reasoning"] }),
  });
  if (!res.ok) {
    return { success: false, error: `Close API error ${res.status}` };
  }
  const data: unknown = await res.json();
  return { success: true, data };
}

async function handleSetHalt(
  input: Record<string, unknown>
): Promise<ToolResult> {
  await db.agentHaltFlag.upsert({
    where: { id: 1 },
    create: { id: 1, halted: input["halted"], reason: input["reason"], setAt: new Date(), setBy: "AGENT" },
    update: { halted: input["halted"], reason: input["reason"], setAt: new Date(), setBy: "AGENT" },
  } as unknown);
  return { success: true, data: { halted: input["halted"], reason: input["reason"] } };
}

async function handleSendTelegramSummary(
  input: Record<string, unknown>,
  baseUrl: string
): Promise<ToolResult> {
  const res = await fetch(`${baseUrl}/api/telegram/send`, {
    method: "POST",
    headers: agentHeaders(),
    body: JSON.stringify({ message: input["summary"] }),
  });
  if (!res.ok) {
    return { success: false, error: `Telegram API error ${res.status}` };
  }
  return { success: true, data: { sent: true } };
}

function runScript(command: string, timeoutMs = 300_000): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(command, {
      cwd: resolve(__dirname, "../.."),
      timeout: timeoutMs,
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    return { stdout: stdout.trim(), stderr: "", exitCode: 0 };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: (e.stdout ?? "").trim(),
      stderr: (e.stderr ?? "").trim(),
      exitCode: e.status ?? 1,
    };
  }
}

function handleRunUniverseSnapshot(): ToolResult {
  const result = runScript("npx tsx scripts/snapshotUniverse.ts");
  if (result.exitCode !== 0) {
    return { success: false, error: `Snapshot failed (exit ${result.exitCode}): ${result.stderr || result.stdout}` };
  }
  return { success: true, data: { exitCode: 0, output: result.stdout } };
}

function handleRunAutotune(): ToolResult {
  const result = runScript("npx tsx scripts/autoTune.ts --years 2 --notify");
  if (result.exitCode !== 0) {
    return { success: false, error: `Auto-tune failed (exit ${result.exitCode}): ${result.stderr || result.stdout}` };
  }

  // Read the recommendation file
  try {
    const recPath = resolve(__dirname, "../../data/recommendations/latest.json");
    const raw = readFileSync(recPath, "utf8");
    const recommendation = JSON.parse(raw) as unknown;
    return { success: true, data: { exitCode: 0, recommendation } };
  } catch {
    return { success: true, data: { exitCode: 0, output: result.stdout, note: "Tune completed but could not read recommendation file" } };
  }
}

async function handleVerifyTicker(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const ticker = input["ticker"] as string;
  if (!ticker) {
    return { success: false, error: "ticker is required" };
  }

  try {
    const { loadT212Settings, getInstruments, yahooToT212Ticker } = await import("@/lib/t212/client");

    const settings = loadT212Settings();
    if (!settings) {
      return { success: true, data: { valid: false, t212Symbol: null, tradeable: false, reason: "T212 not configured — no API key" } };
    }

    const instruments = await getInstruments(settings);

    // Try variations in order: exact, +.L, without suffix, +.US
    const variations = [ticker];
    if (!ticker.includes(".")) {
      variations.push(`${ticker}.L`);
      variations.push(`${ticker}.US`);
    } else {
      const base = ticker.split(".")[0] ?? ticker;
      variations.push(base);
    }

    let t212Symbol: string | null = null;
    let matchedYahoo: string | null = null;

    for (const variant of variations) {
      const match = yahooToT212Ticker(variant, instruments);
      if (match) {
        t212Symbol = match;
        matchedYahoo = variant;
        break;
      }
    }

    if (!t212Symbol) {
      return {
        success: true,
        data: {
          valid: false,
          t212Symbol: null,
          tradeable: false,
          reason: `No T212 instrument found for ${ticker} (tried: ${variations.join(", ")})`,
        },
      };
    }

    const inst = instruments.find((i) => i.ticker === t212Symbol);

    return {
      success: true,
      data: {
        valid: true,
        t212Symbol,
        yahooTicker: matchedYahoo,
        instrumentName: inst?.name ?? null,
        currency: inst?.currencyCode ?? null,
        tradeable: true,
        reason: matchedYahoo !== ticker
          ? `Matched as ${matchedYahoo} → ${t212Symbol}`
          : `Direct match → ${t212Symbol}`,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `T212 instrument lookup failed: ${message}` };
  }
}

async function handleCheckT212Connection(): Promise<ToolResult> {
  try {
    const { loadT212Settings, testConnection } = await import("@/lib/t212/client");

    const settings = loadT212Settings();
    if (!settings) {
      return {
        success: true,
        data: { connected: false, latencyMs: 0, reason: "T212 not configured — no API key" },
      };
    }

    const start = Date.now();
    const result = await testConnection(settings);
    const latencyMs = Date.now() - start;

    if (result.success) {
      return {
        success: true,
        data: {
          connected: true,
          latencyMs,
          currency: result.currency,
          cash: result.cash,
        },
      };
    }

    return {
      success: true,
      data: {
        connected: false,
        latencyMs,
        reason: result.error ?? "T212 connection test failed",
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      success: true,
      data: { connected: false, latencyMs: 0, reason: `T212 connection error: ${message}` },
    };
  }
}

interface PremarketRiskItem {
  ticker: string;
  hasNearTermCatalyst: boolean;
  catalystType: string | null;
  catalystDate: string | null;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  summary: string;
}

// Daily cache for pre-market risk results — avoids repeated API calls per ticker.
// Key: "TICKER:YYYY-MM-DD", value: the risk result for that ticker on that date.
const preMarketRiskCache = new Map<string, PremarketRiskItem>();

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function handleCheckPremarketRisk(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const tickers = input["tickers"] as string[] | undefined;
  if (!tickers || tickers.length === 0) {
    return { success: false, error: "tickers array is required" };
  }

  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";
  if (!apiKey) {
    return {
      success: true,
      data: tickers.map((t) => ({
        ticker: t,
        hasNearTermCatalyst: false,
        catalystType: null,
        catalystDate: null,
        riskLevel: "LOW" as const,
        summary: "Pre-market risk check unavailable — no API key",
      })),
    };
  }

  const today = new Date().toISOString().split("T")[0]!;

  // Check cache first — return cached results for tickers already looked up today
  const cachedResults: PremarketRiskItem[] = [];
  const uncachedTickers: string[] = [];
  for (const t of tickers) {
    const cacheKey = `${t}:${today}`;
    const cached = preMarketRiskCache.get(cacheKey);
    if (cached) {
      cachedResults.push(cached);
    } else {
      uncachedTickers.push(t);
    }
  }

  // If all tickers are cached, return immediately — no API call needed
  if (uncachedTickers.length === 0) {
    return { success: true, data: cachedResults };
  }

  // Look up uncached tickers one at a time with 3s delays to avoid rate limits
  const freshResults: PremarketRiskItem[] = [];
  for (let i = 0; i < uncachedTickers.length; i++) {
    const ticker = uncachedTickers[i]!;
    if (i > 0) await sleep(3000); // 3s delay between API calls

    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          max_tokens: 512,
          tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }],
          messages: [
            {
              role: "user",
              content: `Today is ${today}. Check if ${ticker} has upcoming earnings, FDA decisions, or major binary events within 7 days. Return ONLY JSON: {"ticker":"${ticker}","hasNearTermCatalyst":true/false,"catalystType":"earnings"|null,"catalystDate":"YYYY-MM-DD"|null,"riskLevel":"HIGH"|"MEDIUM"|"LOW","summary":"brief reason"}`,
            },
          ],
        }),
      });

      if (!response.ok) {
        const fallback: PremarketRiskItem = {
          ticker,
          hasNearTermCatalyst: false,
          catalystType: null,
          catalystDate: null,
          riskLevel: "LOW",
          summary: "Pre-market risk check failed — API error",
        };
        freshResults.push(fallback);
        preMarketRiskCache.set(`${ticker}:${today}`, fallback);
        continue;
      }

      const data = (await response.json()) as {
        content: Array<{ type: string; text?: string }>;
      };

      const textBlocks = data.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");

      const jsonMatch = textBlocks.match(/\{[\s\S]*?\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]) as PremarketRiskItem;
        parsed.ticker = ticker; // ensure ticker matches request
        freshResults.push(parsed);
        preMarketRiskCache.set(`${ticker}:${today}`, parsed);
      } else {
        const fallback: PremarketRiskItem = {
          ticker,
          hasNearTermCatalyst: false,
          catalystType: null,
          catalystDate: null,
          riskLevel: "LOW",
          summary: "Could not parse risk check response",
        };
        freshResults.push(fallback);
        preMarketRiskCache.set(`${ticker}:${today}`, fallback);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      const fallback: PremarketRiskItem = {
        ticker,
        hasNearTermCatalyst: false,
        catalystType: null,
        catalystDate: null,
        riskLevel: "LOW",
        summary: `Risk check error: ${message}`,
      };
      freshResults.push(fallback);
      preMarketRiskCache.set(`${ticker}:${today}`, fallback);
    }
  }

  // Merge cached + fresh, preserving original ticker order
  const allResultsMap = new Map<string, PremarketRiskItem>();
  for (const r of cachedResults) allResultsMap.set(r.ticker, r);
  for (const r of freshResults) allResultsMap.set(r.ticker, r);

  const results: PremarketRiskItem[] = tickers.map((t) =>
    allResultsMap.get(t) ?? {
      ticker: t,
      hasNearTermCatalyst: false,
      catalystType: null,
      catalystDate: null,
      riskLevel: "LOW" as const,
      summary: "No data returned for this ticker",
    }
  );

  return { success: true, data: results };
}

async function handleFlagPositionHealth(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const tradeId = input["tradeId"];
  const concern = input["concern"] as string;
  const severity = input["severity"] as string;

  if (!tradeId || !concern || !severity) {
    return { success: false, error: "tradeId, concern, and severity are required" };
  }

  try {
    const db2 = prisma as unknown as {
      agentDecisionLog: { create: (args: unknown) => Promise<unknown> };
    };

    await db2.agentDecisionLog.create({
      data: {
        cycleId: randomUUID(),
        cycleStartedAt: new Date(),
        contextJson: { tradeId, severity },
        reasoning: `Position health flag: [${severity}] ${concern}`,
        actionsJson: JSON.stringify([{ tool: "flag_position_health", tradeId, concern, severity }]),
        outcomeJson: JSON.stringify({ flagged: true }),
        telegramSent: false,
        durationMs: 0,
        errorMessage: null,
      },
    } as unknown);

    return { success: true, data: { flagged: true, tradeId, severity, concern } };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Failed to log health flag: ${message}` };
  }
}

async function handleCheckEquityCurve(): Promise<ToolResult> {
  try {
    const dbSnap = prisma as unknown as {
      accountSnapshot: {
        findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
      };
    };

    const snapshots = await dbSnap.accountSnapshot.findMany({
      orderBy: { date: "desc" },
      take: 30,
    } as unknown);

    if (snapshots.length === 0) {
      return {
        success: true,
        data: {
          peakEquity: null,
          currentEquity: null,
          drawdownPct: 0,
          trend5d: 0,
          trend10d: 0,
          warningLevel: "NORMAL",
          snapshotCount: 0,
          reason: "No account snapshots available",
        },
      };
    }

    // Snapshots are newest-first
    const currentEquity = snapshots[0]!["balance"] as number;
    const peakEquity = Math.max(...snapshots.map((s) => s["balance"] as number));
    const drawdownPct =
      peakEquity > 0
        ? Math.round(((peakEquity - currentEquity) / peakEquity) * 10000) / 100
        : 0;

    // 5-day trend
    const snap5d = snapshots.length >= 5 ? snapshots[4] : snapshots[snapshots.length - 1];
    const equity5d = (snap5d?.["balance"] as number) ?? currentEquity;
    const trend5d =
      equity5d > 0
        ? Math.round(((currentEquity - equity5d) / equity5d) * 10000) / 100
        : 0;

    // 10-day trend
    const snap10d = snapshots.length >= 10 ? snapshots[9] : snapshots[snapshots.length - 1];
    const equity10d = (snap10d?.["balance"] as number) ?? currentEquity;
    const trend10d =
      equity10d > 0
        ? Math.round(((currentEquity - equity10d) / equity10d) * 10000) / 100
        : 0;

    // Warning level
    let warningLevel: "NORMAL" | "WATCH" | "CAUTION" | "CRITICAL";
    if (drawdownPct > 7) {
      warningLevel = "CRITICAL";
    } else if (drawdownPct > 5) {
      warningLevel = "CAUTION";
    } else if (drawdownPct > 3) {
      warningLevel = "WATCH";
    } else {
      warningLevel = "NORMAL";
    }

    return {
      success: true,
      data: {
        peakEquity,
        currentEquity,
        drawdownPct,
        trend5d,
        trend10d,
        warningLevel,
        snapshotCount: snapshots.length,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Equity curve check failed: ${message}` };
  }
}

async function handleGetWeeklySummary(): Promise<ToolResult> {
  try {
    const dbWeek = prisma as unknown as {
      trade: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
      agentDecisionLog: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
      stopHistory: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
      executionLog: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    };

    const now = new Date();
    const weekAgo = new Date(now.getTime() - 7 * 86400000);

    // Trades opened this week
    const tradesOpened = await dbWeek.trade.findMany({
      where: { entryDate: { gte: weekAgo } },
      orderBy: { entryDate: "desc" },
    } as unknown);

    // Trades closed this week
    const tradesClosed = await dbWeek.trade.findMany({
      where: { status: "CLOSED", exitDate: { gte: weekAgo } },
      orderBy: { exitDate: "desc" },
    } as unknown);

    // Still open trades
    const tradesOpen = await dbWeek.trade.findMany({
      where: { status: "OPEN" },
      orderBy: { entryDate: "asc" },
    } as unknown);

    // Agent cycles this week
    const agentCycles = await dbWeek.agentDecisionLog.findMany({
      where: { createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" },
    } as unknown);

    // Stop ratchets this week
    const ratchets = await dbWeek.stopHistory.findMany({
      where: { date: { gte: weekAgo }, changed: true },
    } as unknown);

    // Execution logs this week (skipped/failed signals)
    const execLogs = await dbWeek.executionLog.findMany({
      where: { createdAt: { gte: weekAgo } },
      orderBy: { createdAt: "desc" },
    } as unknown);

    // Compute closed trade stats
    const closedStats = tradesClosed.map((t) => {
      const entry = t.entryPrice as number;
      const exit = t.exitPrice as number;
      const shares = t.shares as number;
      const pnl = (exit - entry) * shares;
      const pnlPct = entry > 0 ? ((exit - entry) / entry) * 100 : 0;
      return {
        ticker: t.ticker as string,
        pnl: Math.round(pnl * 100) / 100,
        pnlPct: Math.round(pnlPct * 100) / 100,
        rMultiple: (t.rMultiple as number) ?? null,
        exitReason: (t.exitReason as string) ?? null,
        holdDays: Math.floor(
          ((t.exitDate as Date).getTime() - (t.entryDate as Date).getTime()) / 86400000
        ),
      };
    });

    const winners = closedStats.filter((t) => t.pnl > 0);
    const losers = closedStats.filter((t) => t.pnl <= 0);
    const totalPnl = closedStats.reduce((sum, t) => sum + t.pnl, 0);
    const avgHoldDays = closedStats.length > 0
      ? Math.round(closedStats.reduce((sum, t) => sum + t.holdDays, 0) / closedStats.length)
      : 0;
    const bestTrade = closedStats.length > 0
      ? closedStats.reduce((best, t) => (t.pnl > best.pnl ? t : best))
      : null;
    const worstTrade = closedStats.length > 0
      ? closedStats.reduce((worst, t) => (t.pnl < worst.pnl ? t : worst))
      : null;

    // Extract skipped signals from exec logs
    const skippedSignals = execLogs
      .filter((l) => {
        const event = l.event as string;
        return event === "PRE_FLIGHT_FAIL" || event === "EXPIRED" || event === "CANCELLED";
      })
      .map((l) => ({
        orderId: l.orderId as number,
        event: l.event as string,
        detail: l.detail as string,
        at: (l.createdAt as Date).toISOString(),
      }));

    // Extract health flags from agent cycles
    const healthFlags = agentCycles
      .filter((c) => {
        const cycleId = c.cycleId as string;
        return cycleId.startsWith("health-flag-");
      })
      .map((c) => ({
        reasoning: c.reasoning as string,
        at: (c.createdAt as Date).toISOString(),
      }));

    return {
      success: true,
      data: {
        period: { from: weekAgo.toISOString(), to: now.toISOString() },
        tradesOpened: tradesOpened.map((t) => ({
          ticker: t.ticker as string,
          entryPrice: t.entryPrice as number,
          sector: (t.sector as string) ?? null,
        })),
        tradesClosed: closedStats,
        tradesOpen: tradesOpen.map((t) => ({
          ticker: t.ticker as string,
          entryPrice: t.entryPrice as number,
          currentStop: t.trailingStop as number,
          sector: (t.sector as string) ?? null,
          daysOpen: Math.floor(
            (now.getTime() - (t.entryDate as Date).getTime()) / 86400000
          ),
        })),
        performance: {
          totalPnl: Math.round(totalPnl * 100) / 100,
          winners: winners.length,
          losers: losers.length,
          winRate: closedStats.length > 0
            ? Math.round((winners.length / closedStats.length) * 100)
            : null,
          avgHoldDays,
          bestTrade,
          worstTrade,
        },
        activity: {
          agentCycles: agentCycles.length,
          stopRatchets: ratchets.length,
          skippedSignals,
          healthFlags,
        },
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Weekly summary query failed: ${message}` };
  }
}
