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
          type: "string" as const,
          description: "The Trade ID (cuid string) to close.",
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
          type: "string" as const,
          description: "The Trade ID (cuid string) to flag.",
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
  {
    name: "write_trade_journal",
    description:
      "Writes a plain-English post-mortem for a closed trade and saves it to the TradeJournal table. Idempotent — if a journal already exists for this trade, returns saved=false. Calls Anthropic directly to generate the narrative and structured lessons. Use during the Friday debrief for any closed trades that don't yet have a journal entry.",
    input_schema: {
      type: "object" as const,
      properties: {
        tradeId: {
          type: "string" as const,
          description: "The Trade ID (cuid string) to journal.",
        },
      },
      required: ["tradeId"],
    },
  },
  {
    name: "get_unjournaled_trades",
    description:
      "Returns closed trades from the past 30 days that do not yet have a TradeJournal entry. Use this at the start of the Friday debrief to find trades to journal.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "check_regime_health",
    description:
      "Leading-indicator regime deterioration check. Independent of the official regimeFilter (which uses QQQ + 200-day MA). Looks at SPY 5d/20d trend, FTSE 20d trend, days-above-20d-MA, and the latest breadth advance/decline. Returns a 0-100 deteriorationScore and a warning level (NONE/WATCH/WARNING/CRITICAL). Cached once per calendar day — first call computes, subsequent calls the same day return the cached result. Call early in every cycle so the agent can warn before the official regime flip.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "run_drawdown_forensics",
    description:
      "Structured drawdown analysis. Identifies the drawdown window (from the last equity peak), lists all trades that contributed, classifies the dominant cause (SINGLE_POSITION / SECTOR_CONCENTRATION / REGIME_FAILURE / BROAD_MARKET / UNKNOWN), and returns a recommendation. Call this when check_equity_curve returns warningLevel=CAUTION or CRITICAL, and during the Friday debrief if the week ended in CAUTION/CRITICAL. Returns the full forensics report — include it in the Telegram summary.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "get_prescan_intelligence",
    description:
      "Forward-looking pre-scan briefing for the week ahead. Aggregates: sectors with momentum (from the latest SectorScanResult), watchlist tickers (top scoring near-misses from recent PendingOrders that didn't execute), persistent near-misses (tickers that have appeared 2+ times in the last 30 days but never executed), recently profitable signal characteristics (from the last 3 BacktestRun rows), and current open-position sector exposure. Call this once on Sunday after the auto-tune verdict, before send_telegram_summary, to produce a MONDAY OUTLOOK.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "analyse_autotune_recommendation",
    description:
      "Cross-references the latest auto-tune recommendation against live context: current open trades (would they have been sized differently?), the last 10 closed trades (would they still have made the grade?), current AppSettings, and current regime. Returns a 0-100 promotionConfidence score, a confidenceLevel (LOW/MEDIUM/HIGH), an impact summary, and pre-written PowerShell setx commands ready to copy-paste. Call this on Sunday immediately after run_autotune (replaces the manual interpretation step).",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "check_portfolio_correlation",
    description:
      "Checks whether the open positions are more correlated than their sector labels suggest. Computes pairwise Pearson correlations on the last 20 days of daily returns for every open ticker, then returns the mean portfolio correlation, the most correlated pair, and a level (LOW <0.3, MODERATE 0.3-0.5, HIGH 0.5-0.7, EXTREME >0.7). Cached once per calendar day. Call once per cycle. Mention HIGH/EXTREME in the Telegram summary; on EXTREME, recommend not adding new positions in sectors that would push correlation higher.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "curate_universe",
    description:
      "Monthly universe curation. Reviews every active Ticker against four DB-only signals: lastQuoteAge (>30d = likely delisted), signalCount30d (0 for 90+ days = not generating signals), executionCount (0 ever and >180 days in universe = never contributed), avgLiquidity (last 10 daily volumes; <50,000 = liquidity concern). Categorises each ticker as REMOVE, REVIEW, or HEALTHY. Returns capped lists (20 remove, 30 review) and a summary. Advisory only — never auto-removes tickers. Run on the first Sunday of the month after get_last_curation_date confirms it is due.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "get_last_curation_date",
    description:
      "Looks up the most recent AgentDecisionLog cycle whose actionsJson recorded a curate_universe call. Returns { lastCurationDate, daysSinceLastCuration }. Call this at the start of every Sunday cycle. If daysSinceLastCuration > 28 (or null), call curate_universe; otherwise skip it.",
    input_schema: {
      type: "object" as const,
      properties: {},
      required: [] as string[],
    },
  },
  {
    name: "trigger_opportunity_scan",
    description:
      "Triggers an immediate fresh scan of the universe via the /api/scan endpoint. Use this OPPORTUNISTICALLY when a slot has just freed up (slotsAvailable > 0) AND there are no current pending signals — it produces fresh PendingOrders so the next cycle has signals available immediately. Do NOT call when pending signals already exist (avoid hammering the scan engine). Subject to a 2/min rate limit on the underlying endpoint.",
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
      case "write_trade_journal":
        return await handleWriteTradeJournal(toolInput);
      case "get_unjournaled_trades":
        return await handleGetUnjournaledTrades();
      case "check_regime_health":
        return await handleCheckRegimeHealth();
      case "run_drawdown_forensics":
        return await handleRunDrawdownForensics();
      case "get_prescan_intelligence":
        return await handleGetPrescanIntelligence();
      case "analyse_autotune_recommendation":
        return await handleAnalyseAutotuneRecommendation();
      case "check_portfolio_correlation":
        return await handleCheckPortfolioCorrelation();
      case "curate_universe":
        return await handleCurateUniverse();
      case "get_last_curation_date":
        return await handleGetLastCurationDate();
      case "trigger_opportunity_scan":
        return await handleTriggerOpportunityScan(baseUrl);
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
  if (order["status"] !== "pending") {
    return { success: false, error: `Order is not pending — skipping.` };
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
  const tradeId = input["tradeId"];
  if (typeof tradeId !== "string" || tradeId.length === 0) {
    return { success: false, error: "tradeId (string cuid) is required" };
  }
  const trade = await db.trade.findUnique({
    where: { id: tradeId },
  } as unknown);
  if (!trade) {
    return { success: false, error: `Trade ${tradeId} not found.` };
  }
  if (trade["status"] !== "OPEN") {
    return { success: false, error: `Trade ${tradeId} is not OPEN.` };
  }
  const res = await fetch(`${baseUrl}/api/trades/${tradeId}/close`, {
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
  const halted = Boolean(input["halted"]);
  // On RESUME (halted=false), clear the reason so stale halt reasons don't linger.
  const reason = halted ? (input["reason"] ?? null) : null;
  await db.agentHaltFlag.upsert({
    where: { id: 1 },
    create: { id: 1, halted, reason, setAt: new Date(), setBy: "AGENT" },
    update: { halted, reason, setAt: new Date(), setBy: "AGENT" },
  } as unknown);
  return { success: true, data: { halted, reason } };
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

interface JournalLessons {
  whatWorked: string[];
  whatFailed: string[];
  ruleToRemember: string;
  tags: string[];
}

async function handleWriteTradeJournal(
  input: Record<string, unknown>
): Promise<ToolResult> {
  const tradeId = input["tradeId"];
  if (typeof tradeId !== "string" || tradeId.length === 0) {
    return { success: false, error: "tradeId (string cuid) is required" };
  }

  const dbJ = prisma as unknown as {
    trade: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> };
    stopHistory: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    pendingOrder: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
    executionLog: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    tradeJournal: {
      findUnique: (args: unknown) => Promise<Record<string, unknown> | null>;
      create: (args: unknown) => Promise<Record<string, unknown>>;
    };
  };

  // Idempotency — if a journal already exists, do nothing.
  const existing = await dbJ.tradeJournal.findUnique({ where: { tradeId } } as unknown);
  if (existing) {
    return { success: true, data: { saved: false, tradeId, reason: "Journal already exists" } };
  }

  const trade = await dbJ.trade.findUnique({ where: { id: tradeId } } as unknown);
  if (!trade) {
    return { success: false, error: `Trade ${tradeId} not found.` };
  }
  if (trade["status"] !== "CLOSED") {
    return { success: false, error: `Trade ${tradeId} is not CLOSED — cannot journal.` };
  }
  if (!trade["exitDate"] || trade["exitPrice"] == null) {
    return { success: false, error: `Trade ${tradeId} missing exitDate or exitPrice.` };
  }

  const ticker = trade["ticker"] as string;
  const entryDate = trade["entryDate"] as Date;
  const exitDate = trade["exitDate"] as Date;
  const entryPrice = trade["entryPrice"] as number;
  const exitPrice = trade["exitPrice"] as number;
  const shares = trade["shares"] as number;
  const grade = (trade["signalGrade"] as string) ?? "N/A";
  const exitReason = (trade["exitReason"] as string) ?? "UNKNOWN";
  const pnlR = (trade["rMultiple"] as number) ?? 0;
  const pnlGbp = Math.round((exitPrice - entryPrice) * shares * 100) / 100;
  const holdDays = Math.max(
    0,
    Math.floor((exitDate.getTime() - entryDate.getTime()) / 86400000)
  );

  // Stop history (direct FK)
  const stops = await dbJ.stopHistory.findMany({
    where: { tradeId },
    orderBy: { date: "asc" },
  } as unknown);
  const stopTimeline = stops.map((s) => ({
    date: (s["date"] as Date).toISOString().split("T")[0],
    level: s["stopLevel"] as number,
    type: s["stopType"] as string,
    changed: s["changed"] as boolean,
  }));

  // Best-effort PendingOrder lookup (matched by ticker around entry date).
  const dayMs = 86400000;
  const pendingOrder = await dbJ.pendingOrder.findFirst({
    where: {
      ticker,
      executedAt: {
        gte: new Date(entryDate.getTime() - dayMs),
        lte: new Date(entryDate.getTime() + dayMs),
      },
    },
    orderBy: { executedAt: "desc" },
  } as unknown);

  let execEvents: Array<Record<string, unknown>> = [];
  if (pendingOrder) {
    execEvents = await dbJ.executionLog.findMany({
      where: { orderId: pendingOrder["id"] },
      orderBy: { createdAt: "asc" },
    } as unknown);
  }
  const execTimeline = execEvents.map((e) => ({
    event: e["event"] as string,
    detail: e["detail"] as string,
    at: (e["createdAt"] as Date).toISOString(),
  }));

  const apiKey = process.env["ANTHROPIC_API_KEY"] ?? "";

  // Default narrative + lessons (used if Anthropic unavailable or fails).
  const fallbackNarrative =
    `Trade ${ticker} closed after ${holdDays} day${holdDays === 1 ? "" : "s"}. ` +
    `Entered at ${entryPrice} (grade ${grade}), exited at ${exitPrice} via ${exitReason}. ` +
    `P&L: £${pnlGbp.toFixed(2)} (${pnlR >= 0 ? "+" : ""}${pnlR.toFixed(2)}R). ` +
    `Stops moved ${stopTimeline.filter((s) => s.changed).length} time(s) during the hold. ` +
    `Anthropic narrative unavailable — this is a fallback summary.`;
  const fallbackLessons: JournalLessons = {
    whatWorked: [],
    whatFailed: [],
    ruleToRemember: "Anthropic narrative unavailable — review trade manually.",
    tags: [exitReason, grade, pnlR >= 0 ? "winner" : "loser"],
  };

  let narrative = fallbackNarrative;
  let lessons: JournalLessons = fallbackLessons;

  if (apiKey) {
    try {
      const tradeContext = {
        ticker,
        grade,
        entryDate: entryDate.toISOString(),
        exitDate: exitDate.toISOString(),
        holdDays,
        entryPrice,
        exitPrice,
        shares,
        pnlGbp,
        pnlR: Math.round(pnlR * 100) / 100,
        exitReason,
        signalSource: trade["signalSource"] ?? null,
        signalScore: trade["signalScore"] ?? null,
        sector: trade["sector"] ?? null,
        volumeRatio: trade["volumeRatio"] ?? null,
        rangePosition: trade["rangePosition"] ?? null,
        atr20: trade["atr20"] ?? null,
        isRunner: trade["isRunner"] ?? false,
        runnerPeakProfit: trade["runnerPeakProfit"] ?? null,
        runnerCaptureRate: trade["runnerCaptureRate"] ?? null,
        stopHistory: stopTimeline,
        executionEvents: execTimeline,
      };

      const userPrompt =
        `You are reviewing a closed VolumeTurtle trade. Write a concise plain-English post-mortem (3-6 sentences) and extract structured lessons.\n\n` +
        `TRADE DATA (JSON):\n${JSON.stringify(tradeContext, null, 2)}\n\n` +
        `Return ONLY a JSON object with this exact shape — no prose outside the JSON:\n` +
        `{\n` +
        `  "narrative": "Plain English post-mortem covering: what the setup was, how it played out, what the stop did, why it exited, and what we should remember.",\n` +
        `  "lessons": {\n` +
        `    "whatWorked": ["short bullet", "short bullet"],\n` +
        `    "whatFailed": ["short bullet"],\n` +
        `    "ruleToRemember": "One sentence rule for future trades.",\n` +
        `    "tags": ["winner|loser", "grade-X", "exit-reason", "sector-X", "any-pattern-tags"]\n` +
        `  }\n` +
        `}`;

      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": apiKey,
        },
        body: JSON.stringify({
          model: DEFAULT_MODEL,
          max_tokens: 1024,
          messages: [{ role: "user", content: userPrompt }],
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as {
          content: Array<{ type: string; text?: string }>;
        };
        const textBlocks = data.content
          .filter((b) => b.type === "text")
          .map((b) => b.text ?? "")
          .join("");
        const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]) as {
            narrative?: string;
            lessons?: Partial<JournalLessons>;
          };
          if (typeof parsed.narrative === "string" && parsed.narrative.length > 0) {
            narrative = parsed.narrative;
          }
          if (parsed.lessons) {
            lessons = {
              whatWorked: Array.isArray(parsed.lessons.whatWorked) ? parsed.lessons.whatWorked : [],
              whatFailed: Array.isArray(parsed.lessons.whatFailed) ? parsed.lessons.whatFailed : [],
              ruleToRemember:
                typeof parsed.lessons.ruleToRemember === "string"
                  ? parsed.lessons.ruleToRemember
                  : fallbackLessons.ruleToRemember,
              tags: Array.isArray(parsed.lessons.tags) ? parsed.lessons.tags : fallbackLessons.tags,
            };
          }
        }
      }
    } catch {
      // Fall through to fallback narrative/lessons.
    }
  }

  const created = await dbJ.tradeJournal.create({
    data: {
      tradeId,
      ticker,
      openedAt: entryDate,
      closedAt: exitDate,
      holdDays,
      entryPrice,
      exitPrice,
      pnlR: Math.round(pnlR * 100) / 100,
      pnlGbp,
      grade,
      narrative,
      lessonsJson: lessons,
    },
  } as unknown);

  return {
    success: true,
    data: {
      saved: true,
      tradeId,
      journalId: created["id"] as number,
      narrativeChars: narrative.length,
      usedAnthropic: apiKey.length > 0 && narrative !== fallbackNarrative,
    },
  };
}

async function handleGetUnjournaledTrades(): Promise<ToolResult> {
  const dbU = prisma as unknown as {
    trade: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
    tradeJournal: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  };

  const since = new Date(Date.now() - 30 * 86400000);
  const closedTrades = await dbU.trade.findMany({
    where: { status: "CLOSED", exitDate: { gte: since } },
    orderBy: { exitDate: "desc" },
  } as unknown);

  if (closedTrades.length === 0) {
    return { success: true, data: { count: 0, trades: [] } };
  }

  const journals = await dbU.tradeJournal.findMany({
    where: { tradeId: { in: closedTrades.map((t) => t["id"] as string) } },
  } as unknown);
  const journaled = new Set(journals.map((j) => j["tradeId"] as string));

  const unjournaled = closedTrades
    .filter((t) => !journaled.has(t["id"] as string))
    .map((t) => ({
      tradeId: t["id"] as string,
      ticker: t["ticker"] as string,
      exitDate: (t["exitDate"] as Date).toISOString(),
      exitReason: (t["exitReason"] as string) ?? null,
      rMultiple: (t["rMultiple"] as number) ?? null,
    }));

  return {
    success: true,
    data: { count: unjournaled.length, trades: unjournaled },
  };
}

// ---------------------------------------------------------------------------
// check_regime_health — leading-indicator deterioration check
// ---------------------------------------------------------------------------

interface RegimeIndicators {
  spy20dTrend: number | null;
  spy5dTrend: number | null;
  ftse20dTrend: number | null;
  daysAbove20dMa: number | null;
  advanceDeclineRatio: number | null;
  regimeCurrentlyBullish: boolean | null;
}

interface RegimeHealthResult {
  deteriorationScore: number;
  warningLevel: "NONE" | "WATCH" | "WARNING" | "CRITICAL";
  indicators: RegimeIndicators;
  summary: string;
  asOf: string;
  cached: boolean;
}

// Daily cache: key = YYYY-MM-DD. Survives within the process lifetime.
const regimeHealthCache = new Map<string, RegimeHealthResult>();

interface YahooBar {
  date: Date;
  close: number | null | undefined;
}

async function fetchYahooCloses(
  ticker: string,
  days: number
): Promise<number[]> {
  try {
    const { default: YahooFinance } = await import("yahoo-finance2");
    const yahoo = new YahooFinance();
    const now = new Date();
    const start = new Date();
    start.setDate(now.getDate() - days);
    const result = await yahoo.chart(ticker, {
      period1: start,
      period2: now,
      interval: "1d",
    });
    const quotes = (result.quotes ?? []) as YahooBar[];
    return quotes
      .map((q) => q.close)
      .filter((c): c is number => c != null && Number.isFinite(c));
  } catch {
    return [];
  }
}

function pctChange(closes: number[], lookback: number): number | null {
  if (closes.length <= lookback) return null;
  const last = closes[closes.length - 1]!;
  const prior = closes[closes.length - 1 - lookback]!;
  if (prior === 0) return null;
  return ((last - prior) / prior) * 100;
}

function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null;
  const slice = closes.slice(-period);
  return slice.reduce((s, c) => s + c, 0) / slice.length;
}

async function handleCheckRegimeHealth(): Promise<ToolResult> {
  const today = new Date().toISOString().split("T")[0]!;

  const cached = regimeHealthCache.get(today);
  if (cached) {
    return { success: true, data: { ...cached, cached: true } };
  }

  // Fetch ~45 days so we have enough history for 20d trend + 20d MA + buffer
  // for non-trading days. SPY and ^FTSE are not in the DailyQuote universe;
  // we fetch live from Yahoo (same pattern as regimeFilter.ts QQQ/^VIX).
  const [spyCloses, ftseCloses] = await Promise.all([
    fetchYahooCloses("SPY", 45),
    fetchYahooCloses("^FTSE", 45),
  ]);

  const spy20dTrend = pctChange(spyCloses, 20);
  const spy5dTrend = pctChange(spyCloses, 5);
  const ftse20dTrend = pctChange(ftseCloses, 20);

  // Days above 20d MA over the last 10 trading days (rolling 20d MA).
  let daysAbove20dMa: number | null = null;
  if (spyCloses.length >= 30) {
    let count = 0;
    for (let i = spyCloses.length - 10; i < spyCloses.length; i++) {
      const window = spyCloses.slice(i - 19, i + 1);
      if (window.length === 20) {
        const ma = window.reduce((s, c) => s + c, 0) / 20;
        if (spyCloses[i]! >= ma) count++;
      }
    }
    daysAbove20dMa = count;
  }

  // Latest breadth advance/decline from ScanRun
  let advanceDeclineRatio: number | null = null;
  try {
    const dbR = prisma as unknown as {
      scanRun: { findFirst: (args: unknown) => Promise<Record<string, unknown> | null> };
    };
    const latest = await dbR.scanRun.findFirst({
      where: { advanceDeclinePct: { not: null } },
      orderBy: { startedAt: "desc" },
    } as unknown);
    if (latest && latest["advanceDeclinePct"] != null) {
      advanceDeclineRatio = latest["advanceDeclinePct"] as number;
    }
  } catch {
    // Leave null on failure.
  }

  // Current regime — call the existing sacred regimeFilter, never modify.
  let regimeCurrentlyBullish: boolean | null = null;
  try {
    const { calculateMarketRegime } = await import("@/lib/signals/regimeFilter");
    const regime = await calculateMarketRegime();
    regimeCurrentlyBullish = regime.marketRegime === "BULLISH";
  } catch {
    // Leave null on failure.
  }

  // ---- Deterioration scoring (0-100, additive) -------------------------
  // Each indicator contributes up to a fixed weight. Missing data = 0
  // contribution (we don't penalise the unknown). Total max = 100.
  let score = 0;
  const reasons: string[] = [];

  // SPY 20d trend (weight 25): negative is bad
  if (spy20dTrend != null) {
    if (spy20dTrend < -5) { score += 25; reasons.push(`SPY 20d ${spy20dTrend.toFixed(1)}%`); }
    else if (spy20dTrend < -2) { score += 15; reasons.push(`SPY 20d ${spy20dTrend.toFixed(1)}%`); }
    else if (spy20dTrend < 0) { score += 8; reasons.push(`SPY 20d ${spy20dTrend.toFixed(1)}%`); }
  }

  // SPY 5d trend (weight 20): sharp recent drop is bad
  if (spy5dTrend != null) {
    if (spy5dTrend < -3) { score += 20; reasons.push(`SPY 5d ${spy5dTrend.toFixed(1)}%`); }
    else if (spy5dTrend < -1) { score += 12; reasons.push(`SPY 5d ${spy5dTrend.toFixed(1)}%`); }
    else if (spy5dTrend < 0) { score += 5; reasons.push(`SPY 5d ${spy5dTrend.toFixed(1)}%`); }
  }

  // FTSE 20d trend (weight 15): UK confirmation
  if (ftse20dTrend != null) {
    if (ftse20dTrend < -5) { score += 15; reasons.push(`FTSE 20d ${ftse20dTrend.toFixed(1)}%`); }
    else if (ftse20dTrend < -2) { score += 9; reasons.push(`FTSE 20d ${ftse20dTrend.toFixed(1)}%`); }
    else if (ftse20dTrend < 0) { score += 4; reasons.push(`FTSE 20d ${ftse20dTrend.toFixed(1)}%`); }
  }

  // Days above 20d MA (weight 25): trend strength fading
  if (daysAbove20dMa != null) {
    if (daysAbove20dMa <= 2) { score += 25; reasons.push(`SPY above 20d MA only ${daysAbove20dMa}/10 days`); }
    else if (daysAbove20dMa <= 4) { score += 15; reasons.push(`SPY above 20d MA ${daysAbove20dMa}/10 days`); }
    else if (daysAbove20dMa <= 6) { score += 7; reasons.push(`SPY above 20d MA ${daysAbove20dMa}/10 days`); }
  }

  // Advance/decline (weight 15): breadth confirmation
  if (advanceDeclineRatio != null) {
    if (advanceDeclineRatio < 30) { score += 15; reasons.push(`A/D ${advanceDeclineRatio.toFixed(0)}%`); }
    else if (advanceDeclineRatio < 45) { score += 9; reasons.push(`A/D ${advanceDeclineRatio.toFixed(0)}%`); }
    else if (advanceDeclineRatio < 50) { score += 4; reasons.push(`A/D ${advanceDeclineRatio.toFixed(0)}%`); }
  }

  // Clamp 0-100
  const deteriorationScore = Math.max(0, Math.min(100, Math.round(score)));

  let warningLevel: "NONE" | "WATCH" | "WARNING" | "CRITICAL";
  if (deteriorationScore < 25) warningLevel = "NONE";
  else if (deteriorationScore < 50) warningLevel = "WATCH";
  else if (deteriorationScore < 75) warningLevel = "WARNING";
  else warningLevel = "CRITICAL";

  // SMA reference for summary context (cheap, no extra fetch)
  const spy20Ma = sma(spyCloses, 20);
  const spyLast = spyCloses.length > 0 ? spyCloses[spyCloses.length - 1]! : null;

  const summaryParts: string[] = [];
  summaryParts.push(`Regime health: ${warningLevel} (${deteriorationScore}/100).`);
  if (regimeCurrentlyBullish === true) summaryParts.push("Official regime still BULLISH.");
  else if (regimeCurrentlyBullish === false) summaryParts.push("Official regime BEARISH.");
  if (spyLast != null && spy20Ma != null) {
    const pct = ((spyLast - spy20Ma) / spy20Ma) * 100;
    summaryParts.push(`SPY ${pct >= 0 ? "+" : ""}${pct.toFixed(1)}% vs 20d MA.`);
  }
  if (reasons.length > 0) summaryParts.push(`Drivers: ${reasons.join("; ")}.`);
  else summaryParts.push("No deterioration signals firing.");

  const result: RegimeHealthResult = {
    deteriorationScore,
    warningLevel,
    indicators: {
      spy20dTrend: spy20dTrend == null ? null : Math.round(spy20dTrend * 100) / 100,
      spy5dTrend: spy5dTrend == null ? null : Math.round(spy5dTrend * 100) / 100,
      ftse20dTrend: ftse20dTrend == null ? null : Math.round(ftse20dTrend * 100) / 100,
      daysAbove20dMa,
      advanceDeclineRatio:
        advanceDeclineRatio == null ? null : Math.round(advanceDeclineRatio * 100) / 100,
      regimeCurrentlyBullish,
    },
    summary: summaryParts.join(" "),
    asOf: today,
    cached: false,
  };

  regimeHealthCache.set(today, result);
  return { success: true, data: result };
}

// ---------------------------------------------------------------------------
// run_drawdown_forensics — structured drawdown analysis
// ---------------------------------------------------------------------------

interface ContributingTrade {
  tradeId: string;
  ticker: string;
  sector: string | null;
  status: "OPEN" | "CLOSED";
  entryDate: string;
  exitDate: string | null;
  pnlGbp: number;
  pnlR: number | null;
  pctOfDrawdown: number;
}

type DrawdownCause =
  | "SINGLE_POSITION"
  | "SECTOR_CONCENTRATION"
  | "REGIME_FAILURE"
  | "BROAD_MARKET"
  | "UNKNOWN";

async function handleRunDrawdownForensics(): Promise<ToolResult> {
  const dbF = prisma as unknown as {
    accountSnapshot: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    trade: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    agentDecisionLog: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
  };

  // 1. Establish drawdown window from last 30 snapshots.
  const snapshots = await dbF.accountSnapshot.findMany({
    orderBy: { date: "desc" },
    take: 30,
  } as unknown);

  if (snapshots.length < 2) {
    return {
      success: true,
      data: {
        drawdownStartDate: null,
        drawdownPct: 0,
        peakEquity: null,
        currentEquity: null,
        contributingTrades: [],
        dominantCause: "UNKNOWN" as DrawdownCause,
        causeExplanation: "Not enough account snapshots to compute a drawdown window.",
        recommendation: "Wait for more snapshots before running forensics.",
      },
    };
  }

  // Snapshots come back newest-first — reverse to oldest-first for sweep.
  const ordered = [...snapshots].reverse();
  const currentEquity = ordered[ordered.length - 1]!["balance"] as number;
  const currentDate = ordered[ordered.length - 1]!["date"] as Date;

  // Find the most recent peak: walk forward, track the highest balance and
  // its date. The drawdown window starts at the day AFTER that peak.
  let peakEquity = ordered[0]!["balance"] as number;
  let peakDate = ordered[0]!["date"] as Date;
  for (const s of ordered) {
    const bal = s["balance"] as number;
    if (bal >= peakEquity) {
      peakEquity = bal;
      peakDate = s["date"] as Date;
    }
  }

  const drawdownGbp = peakEquity - currentEquity;
  const drawdownPct =
    peakEquity > 0
      ? Math.round((drawdownGbp / peakEquity) * 10000) / 100
      : 0;

  if (drawdownGbp <= 0) {
    return {
      success: true,
      data: {
        drawdownStartDate: peakDate.toISOString().split("T")[0],
        drawdownPct: 0,
        peakEquity,
        currentEquity,
        contributingTrades: [],
        dominantCause: "UNKNOWN" as DrawdownCause,
        causeExplanation: "No drawdown — current equity at or above recent peak.",
        recommendation: "No action required.",
      },
    };
  }

  // 2. Find trades active during the drawdown window (peakDate → currentDate).
  // A trade contributed if it was OPEN at any point in the window OR closed
  // inside the window.
  const windowStart = peakDate;
  const windowEnd = currentDate;

  const trades = await dbF.trade.findMany({
    where: {
      OR: [
        // Closed inside window
        { exitDate: { gte: windowStart, lte: windowEnd } },
        // Still open and entered before/during window
        { status: "OPEN", entryDate: { lte: windowEnd } },
        // Open at start of window then closed later (any close after start)
        { exitDate: { gte: windowStart } },
      ],
    },
  } as unknown);

  // 3. Compute each trade's £ contribution to the drawdown.
  // For closed trades: realised P&L = (exit - entry) * shares.
  // For open trades: mark-to-current-stop as a conservative proxy
  //   (matches the close-route's exit-at-stop convention).
  const contributing: ContributingTrade[] = [];
  for (const t of trades) {
    const entry = t["entryPrice"] as number;
    const shares = t["shares"] as number;
    const status = t["status"] as string;
    const exitPrice = (t["exitPrice"] as number | null) ??
      (t["trailingStopPrice"] as number | null) ??
      (t["trailingStop"] as number | null) ??
      entry;
    const pnlGbp = Math.round((exitPrice - entry) * shares * 100) / 100;

    // Only count negative contributions toward the drawdown (winners offset).
    // Net total of all contributions should approximate -drawdownGbp.
    contributing.push({
      tradeId: t["id"] as string,
      ticker: t["ticker"] as string,
      sector: (t["sector"] as string | null) ?? null,
      status: status === "OPEN" ? "OPEN" : "CLOSED",
      entryDate: (t["entryDate"] as Date).toISOString().split("T")[0]!,
      exitDate: t["exitDate"]
        ? (t["exitDate"] as Date).toISOString().split("T")[0]!
        : null,
      pnlGbp,
      pnlR: (t["rMultiple"] as number | null) ?? null,
      pctOfDrawdown:
        drawdownGbp > 0
          ? Math.round((Math.max(0, -pnlGbp) / drawdownGbp) * 10000) / 100
          : 0,
    });
  }

  // Sort losers first by pctOfDrawdown
  contributing.sort((a, b) => b.pctOfDrawdown - a.pctOfDrawdown);

  // 4. Skipped signals during the drawdown window
  const cycles = await dbF.agentDecisionLog.findMany({
    where: { createdAt: { gte: windowStart } },
    orderBy: { createdAt: "asc" },
  } as unknown);
  const skippedSignalCount = cycles.filter((c) => {
    const actions = (c["actionsJson"] as string) ?? "[]";
    return actions.includes('"skipped"') || actions.includes('"SKIPPED"');
  }).length;

  // 5. Cause classification
  let dominantCause: DrawdownCause = "UNKNOWN";
  let causeExplanation = "";

  // Top loser concentration
  const losers = contributing.filter((t) => t.pnlGbp < 0);
  const topLoser = losers[0] ?? null;

  // Sector concentration: 2+ losers in the same sector accounting for >50%
  const sectorTotals = new Map<string, number>();
  for (const t of losers) {
    if (!t.sector) continue;
    sectorTotals.set(t.sector, (sectorTotals.get(t.sector) ?? 0) + t.pctOfDrawdown);
  }
  let dominantSector: string | null = null;
  let dominantSectorShare = 0;
  for (const [sector, pct] of sectorTotals) {
    const sectorLosersCount = losers.filter((l) => l.sector === sector).length;
    if (sectorLosersCount >= 2 && pct > dominantSectorShare) {
      dominantSector = sector;
      dominantSectorShare = pct;
    }
  }

  // Regime check: did the official regime flip during the window?
  let regimeFlippedDuringWindow = false;
  let regimeNowBearish = false;
  try {
    const { calculateMarketRegime } = await import("@/lib/signals/regimeFilter");
    const regime = await calculateMarketRegime();
    regimeNowBearish = regime.marketRegime === "BEARISH";
    // Heuristic: if the regime is bearish AND the window covers >5 days,
    // assume it flipped during the window.
    const windowDays =
      (windowEnd.getTime() - windowStart.getTime()) / 86400000;
    if (regimeNowBearish && windowDays >= 5) regimeFlippedDuringWindow = true;
  } catch {
    // Regime data unavailable — leave flags false.
  }

  // Broad market: 3+ losers, no single trade >35%, no sector concentration
  const isBroad =
    losers.length >= 3 &&
    (topLoser?.pctOfDrawdown ?? 0) < 35 &&
    dominantSectorShare < 50;

  if (topLoser && topLoser.pctOfDrawdown > 50) {
    dominantCause = "SINGLE_POSITION";
    causeExplanation =
      `${topLoser.ticker} accounts for ${topLoser.pctOfDrawdown.toFixed(1)}% of the drawdown ` +
      `(£${topLoser.pnlGbp.toFixed(2)}). Position-specific risk, not a portfolio-wide issue.`;
  } else if (dominantSector && dominantSectorShare > 50) {
    const sectorLosers = losers.filter((l) => l.sector === dominantSector);
    dominantCause = "SECTOR_CONCENTRATION";
    causeExplanation =
      `${sectorLosers.length} losers in ${dominantSector} account for ${dominantSectorShare.toFixed(1)}% ` +
      `of the drawdown. Sector-wide weakness — review max-per-sector cap.`;
  } else if (regimeFlippedDuringWindow) {
    dominantCause = "REGIME_FAILURE";
    causeExplanation =
      `Market regime flipped to BEARISH during the drawdown window. ` +
      `Pre-existing positions were caught on the wrong side of a regime change.`;
  } else if (isBroad) {
    dominantCause = "BROAD_MARKET";
    causeExplanation =
      `${losers.length} losers spread across sectors, no single trade or sector >50%. ` +
      `Looks like broad market weakness, not a concentration or strategy issue.`;
  } else {
    dominantCause = "UNKNOWN";
    causeExplanation =
      `Mixed signals — ${losers.length} losing trade(s), top contributor ${topLoser?.pctOfDrawdown.toFixed(1) ?? 0}%, ` +
      `top sector share ${dominantSectorShare.toFixed(1)}%. No single dominant pattern.`;
  }

  // 6. Recommendation
  let recommendation: string;
  switch (dominantCause) {
    case "SINGLE_POSITION":
      recommendation = topLoser
        ? `Review ${topLoser.ticker} ${topLoser.status === "OPEN" ? "before next session" : "post-mortem"}. Consider tightening stops on remaining open positions but keep the strategy unchanged.`
        : "Review the largest losing position individually.";
      break;
    case "SECTOR_CONCENTRATION":
      recommendation =
        `Tighten max-per-sector cap or pause new entries in ${dominantSector ?? "the affected sector"} for 1-2 weeks.`;
      break;
    case "REGIME_FAILURE":
      recommendation =
        "Cut new entries entirely until regime flips back to BULLISH. Tighten stops on remaining positions to lock in any profit. Do NOT add to losers.";
      break;
    case "BROAD_MARKET":
      recommendation =
        "Reduce position sizes by ~50% on next entries. Wait for breadth to improve before resuming full size. Do not adjust the strategy itself.";
      break;
    default:
      recommendation =
        "No clear single cause. Run a manual review and check whether stops were honoured. Avoid changing strategy parameters without more data.";
  }

  return {
    success: true,
    data: {
      drawdownStartDate: peakDate.toISOString().split("T")[0],
      drawdownPct,
      peakEquity: Math.round(peakEquity * 100) / 100,
      currentEquity: Math.round(currentEquity * 100) / 100,
      drawdownGbp: Math.round(drawdownGbp * 100) / 100,
      contributingTrades: contributing,
      losersCount: losers.length,
      winnersCount: contributing.length - losers.length,
      skippedSignalCount,
      regimeFlippedDuringWindow,
      regimeNowBearish,
      dominantCause,
      causeExplanation,
      recommendation,
    },
  };
}

// ---------------------------------------------------------------------------
// get_prescan_intelligence — Sunday Monday-outlook briefing
// ---------------------------------------------------------------------------

async function handleGetPrescanIntelligence(): Promise<ToolResult> {
  const dbI = prisma as unknown as {
    sectorScanResult: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    pendingOrder: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    momentumSignal: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    backtestRun: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
    trade: {
      findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
    };
  };

  const now = new Date();
  const twoWeeksAgo = new Date(now.getTime() - 14 * 86400000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

  // 1. Sectors with momentum — most recent SectorScanResult set, top 5 by score.
  let sectorsWithMomentum: Array<{
    sector: string;
    score: number;
    R5: number;
    R20: number;
    hotCount: number;
  }> = [];
  try {
    const sectorRows = await dbI.sectorScanResult.findMany({
      orderBy: { runAt: "desc" },
      take: 50,
    } as unknown);
    if (sectorRows.length > 0) {
      // Take only the latest run's rows
      const latestRunAt = (sectorRows[0]!["runAt"] as Date).getTime();
      const latest = sectorRows.filter(
        (r) => Math.abs((r["runAt"] as Date).getTime() - latestRunAt) < 60_000
      );
      sectorsWithMomentum = latest
        .sort((a, b) => (b["score"] as number) - (a["score"] as number))
        .slice(0, 5)
        .map((r) => ({
          sector: r["sector"] as string,
          score: Math.round((r["score"] as number) * 100) / 100,
          R5: Math.round((r["R5"] as number) * 100) / 100,
          R20: Math.round((r["R20"] as number) * 100) / 100,
          hotCount: (r["hotCount"] as number) ?? 0,
        }));
    }
  } catch {
    /* leave empty */
  }

  // 2. Watchlist tickers — top 20 by compositeScore from PendingOrders in the
  // last 2 weeks that did not execute (status != "executed"). These are the
  // signals that scored well but didn't make it into the book.
  let watchlistTickers: Array<{
    ticker: string;
    sector: string;
    grade: string;
    compositeScore: number;
    status: string;
    createdAt: string;
  }> = [];
  try {
    const orders = await dbI.pendingOrder.findMany({
      where: {
        createdAt: { gte: twoWeeksAgo },
        status: { not: "executed" },
      },
      orderBy: { compositeScore: "desc" },
      take: 50,
    } as unknown);
    // De-duplicate by ticker, keep the highest-scoring instance.
    const byTicker = new Map<string, Record<string, unknown>>();
    for (const o of orders) {
      const ticker = o["ticker"] as string;
      const existing = byTicker.get(ticker);
      if (!existing || (o["compositeScore"] as number) > (existing["compositeScore"] as number)) {
        byTicker.set(ticker, o);
      }
    }
    watchlistTickers = Array.from(byTicker.values())
      .slice(0, 20)
      .map((o) => ({
        ticker: o["ticker"] as string,
        sector: o["sector"] as string,
        grade: o["signalGrade"] as string,
        compositeScore: Math.round((o["compositeScore"] as number) * 100) / 100,
        status: o["status"] as string,
        createdAt: (o["createdAt"] as Date).toISOString().split("T")[0]!,
      }));
  } catch {
    /* leave empty */
  }

  // 3. Persistent near-misses — tickers in PendingOrders 2+ times in last 30d
  // with no execution.
  let persistentNearMisses: Array<{
    ticker: string;
    sector: string;
    appearances: number;
    lastSeen: string;
    bestGrade: string;
  }> = [];
  try {
    const allRecent = await dbI.pendingOrder.findMany({
      where: { createdAt: { gte: thirtyDaysAgo } },
      orderBy: { createdAt: "desc" },
    } as unknown);
    const counts = new Map<
      string,
      { sector: string; total: number; executed: number; lastSeen: Date; bestGrade: string }
    >();
    for (const o of allRecent) {
      const ticker = o["ticker"] as string;
      const existing = counts.get(ticker) ?? {
        sector: o["sector"] as string,
        total: 0,
        executed: 0,
        lastSeen: o["createdAt"] as Date,
        bestGrade: "D",
      };
      existing.total += 1;
      if (o["status"] === "executed") existing.executed += 1;
      const orderDate = o["createdAt"] as Date;
      if (orderDate.getTime() > existing.lastSeen.getTime()) existing.lastSeen = orderDate;
      const grade = o["signalGrade"] as string;
      // A < B < C < D — keep the alphabetically smallest (best)
      if (grade && grade < existing.bestGrade) existing.bestGrade = grade;
      counts.set(ticker, existing);
    }
    persistentNearMisses = Array.from(counts.entries())
      .filter(([, v]) => v.total >= 2 && v.executed === 0)
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 10)
      .map(([ticker, v]) => ({
        ticker,
        sector: v.sector,
        appearances: v.total,
        lastSeen: v.lastSeen.toISOString().split("T")[0]!,
        bestGrade: v.bestGrade,
      }));
  } catch {
    /* leave empty */
  }

  // 4. Recently profitable signal characteristics — last 3 completed BacktestRuns
  let recentlyProfitableCharacteristics: {
    runs: Array<{
      label: string | null;
      engine: string;
      profitFactor: number | null;
      expectancyR: number | null;
      winRate: number | null;
      trades: number;
    }>;
    bestEngine: string | null;
    avgExpectancyR: number | null;
  } = { runs: [], bestEngine: null, avgExpectancyR: null };
  try {
    const runs = await dbI.backtestRun.findMany({
      where: { status: "COMPLETED", expectancyR: { not: null } },
      orderBy: { completedAt: "desc" },
      take: 3,
    } as unknown);
    const mapped = runs.map((r) => ({
      label: (r["label"] as string | null) ?? null,
      engine: (r["engine"] as string) ?? "volume",
      profitFactor: (r["profitFactor"] as number | null) ?? null,
      expectancyR: (r["expectancyR"] as number | null) ?? null,
      winRate: (r["winRate"] as number | null) ?? null,
      trades: (r["trades"] as number) ?? 0,
    }));
    // Best engine = engine with highest avg expectancyR
    const byEngine = new Map<string, number[]>();
    for (const r of mapped) {
      if (r.expectancyR == null) continue;
      const arr = byEngine.get(r.engine) ?? [];
      arr.push(r.expectancyR);
      byEngine.set(r.engine, arr);
    }
    let bestEngine: string | null = null;
    let bestAvg = -Infinity;
    for (const [engine, vals] of byEngine) {
      const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
      if (avg > bestAvg) { bestAvg = avg; bestEngine = engine; }
    }
    const allExpectancies = mapped
      .map((r) => r.expectancyR)
      .filter((v): v is number => v != null);
    const avgExpectancyR = allExpectancies.length > 0
      ? Math.round((allExpectancies.reduce((s, v) => s + v, 0) / allExpectancies.length) * 100) / 100
      : null;
    recentlyProfitableCharacteristics = {
      runs: mapped.map((r) => ({
        ...r,
        profitFactor: r.profitFactor != null ? Math.round(r.profitFactor * 100) / 100 : null,
        expectancyR: r.expectancyR != null ? Math.round(r.expectancyR * 100) / 100 : null,
        winRate: r.winRate != null ? Math.round(r.winRate * 100) / 100 : null,
      })),
      bestEngine,
      avgExpectancyR,
    };
  } catch {
    /* leave defaults */
  }

  // 5. Open sector exposure
  let openSectorExposure: Array<{ sector: string; count: number; tickers: string[] }> = [];
  try {
    const open = await dbI.trade.findMany({
      where: { status: "OPEN" },
    } as unknown);
    const sectorMap = new Map<string, string[]>();
    for (const t of open) {
      const sector = (t["sector"] as string | null) ?? "Unknown";
      const arr = sectorMap.get(sector) ?? [];
      arr.push(t["ticker"] as string);
      sectorMap.set(sector, arr);
    }
    openSectorExposure = Array.from(sectorMap.entries())
      .map(([sector, tickers]) => ({ sector, count: tickers.length, tickers }))
      .sort((a, b) => b.count - a.count);
  } catch {
    /* leave empty */
  }

  return {
    success: true,
    data: {
      asOf: now.toISOString(),
      sectorsWithMomentum,
      watchlistTickers,
      persistentNearMisses,
      recentlyProfitableCharacteristics,
      openSectorExposure,
    },
  };
}

// ---------------------------------------------------------------------------
// analyse_autotune_recommendation — cross-reference recommendation vs context
// ---------------------------------------------------------------------------

interface RecommendationCombo {
  gradeFloor: string;
  riskPct: number;   // decimal, e.g. 0.01
  heatCap: number;   // decimal, e.g. 0.08
  sectorCap: number;
}

interface RecommendationFile {
  generatedAt: string;
  winner?: { combo: RecommendationCombo; profitFactor?: number; expectancyR?: number };
  delta?: { deltaPF: number; deltaScore: number; fromWinnerCombo?: RecommendationCombo };
  oosValidation?: { verdict: string; passes?: boolean; avgOosPf?: number };
  robustness?: { verdict: string };
}

async function handleAnalyseAutotuneRecommendation(): Promise<ToolResult> {
  // 1. Load the recommendation file.
  let rec: RecommendationFile;
  try {
    const recPath = resolve(__dirname, "../../data/recommendations/latest.json");
    const raw = readFileSync(recPath, "utf8");
    rec = JSON.parse(raw) as RecommendationFile;
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Failed to read recommendation file: ${msg}` };
  }

  if (!rec.winner?.combo) {
    return { success: false, error: "Recommendation file has no winner.combo" };
  }

  const recommended = rec.winner.combo;
  const oosVerdict = rec.oosValidation?.verdict ?? "UNKNOWN";
  const deltaPF = rec.delta?.deltaPF ?? 0;
  const deltaScore = rec.delta?.deltaScore ?? 0;

  // 2. Current params from env (matches existing pattern in context.ts)
  const currentRiskPct = parseFloat(process.env["RISK_PER_TRADE_PCT"] ?? "2") / 100;
  const currentHeatCap = parseFloat(process.env["HEAT_CAP_PCT"] ?? "0.08");
  const currentParams = {
    riskPct: currentRiskPct,
    heatCap: currentHeatCap,
    // gradeFloor and sectorCap are not env-tunable today; report N/A.
    gradeFloor: "B" as string,
    sectorCap: 2 as number,
  };

  const delta = {
    riskPctDelta: Math.round((recommended.riskPct - currentRiskPct) * 100000) / 100000,
    heatCapDelta: Math.round((recommended.heatCap - currentHeatCap) * 100000) / 100000,
    gradeFloorChange: recommended.gradeFloor !== currentParams.gradeFloor
      ? `${currentParams.gradeFloor} → ${recommended.gradeFloor}`
      : "no change",
    sectorCapChange: recommended.sectorCap !== currentParams.sectorCap
      ? `${currentParams.sectorCap} → ${recommended.sectorCap}`
      : "no change",
    deltaPF: Math.round(deltaPF * 100) / 100,
    deltaScore: Math.round(deltaScore * 100) / 100,
  };

  // 3. Impact on open trades — would any be sized differently / stopped out?
  const dbA = prisma as unknown as {
    trade: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  };
  const openTrades = await dbA.trade.findMany({
    where: { status: "OPEN" },
  } as unknown);

  // A trade would be "stopped out" by the new params only if the new heat cap
  // is so much tighter that the existing position alone exceeds it. We use
  // dollarRisk vs new heat cap (against current balance approx).
  const balance = parseFloat(process.env["VOLUME_TURTLE_BALANCE"] ?? "10000");
  const newHeatCapGbp = balance * recommended.heatCap;
  const oldHeatCapGbp = balance * currentHeatCap;

  const openImpact = openTrades.map((t) => {
    const entry = t["entryPrice"] as number;
    const stop = (t["hardStop"] as number) ?? entry;
    const shares = t["shares"] as number;
    const riskGbp = Math.max(0, (entry - stop) * shares);
    // Re-size under new params: target risk = balance * recommended.riskPct
    const newTargetRisk = balance * recommended.riskPct;
    const oldTargetRisk = balance * currentRiskPct;
    const sizeRatio = oldTargetRisk > 0 ? newTargetRisk / oldTargetRisk : 1;
    return {
      tradeId: t["id"] as string,
      ticker: t["ticker"] as string,
      sector: (t["sector"] as string | null) ?? null,
      currentRiskGbp: Math.round(riskGbp * 100) / 100,
      sizeChangePct: Math.round((sizeRatio - 1) * 10000) / 100,
      // "Stopped out by new params" proxy: the position alone exceeds new heat cap.
      // (We don't push or close anything — this is advisory only.)
      negativelyImpacted: riskGbp > newHeatCapGbp,
    };
  });

  const totalCurrentRiskGbp = openImpact.reduce((s, t) => s + t.currentRiskGbp, 0);
  const anyStoppedOut = openImpact.some((t) => t.negativelyImpacted);
  const heatCapBreachedNow = totalCurrentRiskGbp > newHeatCapGbp;

  // 4. Re-score the last 10 closed trades under the new gradeFloor.
  // Existing trades store signalGrade — we just check whether they would still
  // pass the new threshold (alphabetical: A < B < C < D, so newer floor "B"
  // means anything with grade <= "B" passes).
  const recentClosed = await dbA.trade.findMany({
    where: { status: "CLOSED" },
    orderBy: { exitDate: "desc" },
    take: 10,
  } as unknown);

  const recentImpact = recentClosed.map((t) => {
    const grade = (t["signalGrade"] as string) ?? "D";
    const wouldStillExecute = grade <= recommended.gradeFloor; // A < B
    const rMultiple = (t["rMultiple"] as number) ?? 0;
    return {
      tradeId: t["id"] as string,
      ticker: t["ticker"] as string,
      grade,
      rMultiple: Math.round(rMultiple * 100) / 100,
      wouldStillExecute,
    };
  });

  const recentExecutable = recentImpact.filter((t) => t.wouldStillExecute).length;
  const recentExecutablePct = recentImpact.length > 0
    ? Math.round((recentExecutable / recentImpact.length) * 100)
    : 100;

  // 5. Current regime (uses sacred regimeFilter)
  let regimeBullish: boolean | null = null;
  try {
    const { calculateMarketRegime } = await import("@/lib/signals/regimeFilter");
    const regime = await calculateMarketRegime();
    regimeBullish = regime.marketRegime === "BULLISH";
  } catch {
    /* leave null */
  }

  // 6. Promotion confidence scoring (per spec)
  let confidence = 0;
  const reasons: string[] = [];

  if (oosVerdict === "PROMOTE_OK") {
    confidence += 30;
    reasons.push("OOS PROMOTE_OK +30");
  }
  if (deltaPF > 0.5) {
    confidence += 20;
    reasons.push(`deltaPF ${deltaPF.toFixed(2)} (>0.5) +20`);
  } else if (deltaPF > 0.3) {
    confidence += 10;
    reasons.push(`deltaPF ${deltaPF.toFixed(2)} (>0.3) +10`);
  }
  if (regimeBullish === true) {
    confidence += 20;
    reasons.push("regime BULLISH +20");
  } else if (regimeBullish === false) {
    confidence -= 20;
    reasons.push("regime BEARISH -20");
  }
  if (!anyStoppedOut && !heatCapBreachedNow) {
    confidence += 20;
    reasons.push("no open trades negatively impacted +20");
  }
  if (anyStoppedOut) {
    confidence -= 30;
    reasons.push("open trade(s) would breach new heat cap -30");
  }

  const promotionConfidence = Math.max(0, Math.min(100, confidence));

  let confidenceLevel: "LOW" | "MEDIUM" | "HIGH";
  if (promotionConfidence >= 70) confidenceLevel = "HIGH";
  else if (promotionConfidence >= 40) confidenceLevel = "MEDIUM";
  else confidenceLevel = "LOW";

  // 7. Verdict + recommendation
  let verdict: "PROMOTE" | "MONITOR" | "IGNORE";
  let recommendation: string;
  if (oosVerdict !== "PROMOTE_OK") {
    verdict = "IGNORE";
    recommendation =
      `OOS gate failed (${oosVerdict}). The recommended config did not validate out-of-sample. ` +
      `Do not promote. Current config stays.`;
  } else if (confidenceLevel === "HIGH" && deltaPF >= 0.3) {
    verdict = "PROMOTE";
    recommendation =
      `High confidence (${promotionConfidence}/100) and meaningful improvement (deltaPF ${deltaPF.toFixed(2)}). ` +
      `Apply the new config.`;
  } else if (confidenceLevel === "MEDIUM") {
    verdict = "MONITOR";
    recommendation =
      `Medium confidence (${promotionConfidence}/100). OOS passed but ${deltaPF < 0.3 ? "improvement is marginal" : "context flags caution"}. ` +
      `Hold current config and re-check next Sunday.`;
  } else {
    verdict = "MONITOR";
    recommendation =
      `Low confidence (${promotionConfidence}/100). OOS passed but live context warns against promoting now. ` +
      `Hold current config.`;
  }

  // 8. Pre-written PowerShell commands
  const exactCommandsToRun: string[] = [];
  if (verdict === "PROMOTE") {
    // Note: env var convention is %, not decimal — RISK_PER_TRADE_PCT=2 means 2%.
    const riskPctEnv = (recommended.riskPct * 100).toFixed(2);
    exactCommandsToRun.push(`setx RISK_PER_TRADE_PCT ${riskPctEnv}`);
    exactCommandsToRun.push(`setx HEAT_CAP_PCT ${recommended.heatCap.toFixed(4)}`);
    exactCommandsToRun.push(`# Then restart the Next.js dev server for changes to take effect.`);
  }

  // Plain-English impact summary
  const impactLines: string[] = [];
  impactLines.push(
    `Open positions: ${openTrades.length}. Total risk now: £${totalCurrentRiskGbp.toFixed(2)} ` +
    `vs new heat cap £${newHeatCapGbp.toFixed(2)} ` +
    `(was £${oldHeatCapGbp.toFixed(2)}).`
  );
  if (anyStoppedOut) {
    const list = openImpact.filter((t) => t.negativelyImpacted).map((t) => t.ticker).join(", ");
    impactLines.push(`⚠ ${list} alone exceeds the new heat cap.`);
  }
  if (recentImpact.length > 0) {
    impactLines.push(
      `Last ${recentImpact.length} closed trades: ${recentExecutable}/${recentImpact.length} ` +
      `(${recentExecutablePct}%) would still pass the new gradeFloor (${recommended.gradeFloor}).`
    );
  }
  const sizeChanges = openImpact.filter((t) => Math.abs(t.sizeChangePct) >= 5);
  if (sizeChanges.length > 0) {
    impactLines.push(
      `Size delta: open trades would be sized ${sizeChanges[0]!.sizeChangePct >= 0 ? "+" : ""}` +
      `${sizeChanges[0]!.sizeChangePct.toFixed(1)}% under new risk %.`
    );
  }

  return {
    success: true,
    data: {
      generatedAt: rec.generatedAt,
      currentParams,
      recommendedParams: recommended,
      delta,
      oosVerdict,
      regimeBullish,
      promotionConfidence,
      confidenceLevel,
      confidenceBreakdown: reasons,
      impactOnOpenTrades: {
        count: openTrades.length,
        totalRiskGbp: Math.round(totalCurrentRiskGbp * 100) / 100,
        newHeatCapGbp: Math.round(newHeatCapGbp * 100) / 100,
        oldHeatCapGbp: Math.round(oldHeatCapGbp * 100) / 100,
        anyNegativelyImpacted: anyStoppedOut,
        heatCapBreachedNow,
        positions: openImpact,
      },
      impactOnRecentTrades: {
        sampleSize: recentImpact.length,
        wouldStillExecute: recentExecutable,
        wouldStillExecutePct: recentExecutablePct,
        trades: recentImpact,
      },
      impactSummary: impactLines.join(" "),
      verdict,
      recommendation,
      exactCommandsToRun,
    },
  };
}

// ---------------------------------------------------------------------------
// check_portfolio_correlation — pairwise Pearson on open-position returns
// ---------------------------------------------------------------------------

interface PairwiseCorrelation {
  a: string;
  b: string;
  correlation: number;
  sharedDays: number;
}

interface CorrelationResult {
  positionCount: number;
  meanCorrelation: number | null;
  correlationLevel: "LOW" | "MODERATE" | "HIGH" | "EXTREME";
  pairwiseCorrelations: PairwiseCorrelation[];
  mostCorrelatedPair: PairwiseCorrelation | null;
  warning: string | null;
  asOf: string;
  cached: boolean;
}

const correlationCache = new Map<string, CorrelationResult>();

function pearsonCorrelation(xs: number[], ys: number[]): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let sumX = 0;
  let sumY = 0;
  for (let i = 0; i < n; i++) {
    sumX += xs[i]!;
    sumY += ys[i]!;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  let num = 0;
  let denX = 0;
  let denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i]! - meanX;
    const dy = ys[i]! - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  if (den === 0) return null;
  return num / den;
}

function returnsFromCloses(closes: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    const prev = closes[i - 1]!;
    if (prev === 0) continue;
    out.push((closes[i]! - prev) / prev);
  }
  return out;
}

async function handleCheckPortfolioCorrelation(): Promise<ToolResult> {
  const today = new Date().toISOString().split("T")[0]!;
  const cached = correlationCache.get(today);
  if (cached) {
    return { success: true, data: { ...cached, cached: true } };
  }

  const dbC = prisma as unknown as {
    trade: { findMany: (args: unknown) => Promise<Array<Record<string, unknown>>> };
  };

  const openTrades = await dbC.trade.findMany({
    where: { status: "OPEN" },
  } as unknown);

  if (openTrades.length < 2) {
    const result: CorrelationResult = {
      positionCount: openTrades.length,
      meanCorrelation: null,
      correlationLevel: "LOW",
      pairwiseCorrelations: [],
      mostCorrelatedPair: null,
      warning: null,
      asOf: today,
      cached: false,
    };
    correlationCache.set(today, result);
    return { success: true, data: result };
  }

  // Fetch the last 21 daily closes for each open ticker (yields 20 daily
  // returns). Use the existing cached helper which respects the
  // Ticker → DailyQuote relationship.
  const since = new Date();
  since.setDate(since.getDate() - 35); // buffer for non-trading days

  const tickers = Array.from(new Set(openTrades.map((t) => t["ticker"] as string)));

  const { getCachedQuotes } = await import("@/lib/data/quoteCache");
  const closesByTicker = new Map<string, number[]>();
  for (const symbol of tickers) {
    try {
      const quotes = await getCachedQuotes(symbol, since);
      const closes = quotes.map((q) => q.close).filter((c) => Number.isFinite(c));
      if (closes.length >= 2) {
        // Keep only the last 21 closes so all tickers align on the most recent
        // window. Tickers with fewer days will simply have shorter return arrays.
        closesByTicker.set(symbol, closes.slice(-21));
      }
    } catch {
      /* skip tickers with no cached data */
    }
  }

  const tickersWithData = Array.from(closesByTicker.keys());
  if (tickersWithData.length < 2) {
    const result: CorrelationResult = {
      positionCount: openTrades.length,
      meanCorrelation: null,
      correlationLevel: "LOW",
      pairwiseCorrelations: [],
      mostCorrelatedPair: null,
      warning:
        "Insufficient cached price data for correlation analysis (need at least 2 tickers with quotes).",
      asOf: today,
      cached: false,
    };
    correlationCache.set(today, result);
    return { success: true, data: result };
  }

  // Compute returns per ticker once
  const returnsByTicker = new Map<string, number[]>();
  for (const [t, closes] of closesByTicker) {
    returnsByTicker.set(t, returnsFromCloses(closes));
  }

  // Pairwise correlations
  const pairs: PairwiseCorrelation[] = [];
  for (let i = 0; i < tickersWithData.length; i++) {
    for (let j = i + 1; j < tickersWithData.length; j++) {
      const a = tickersWithData[i]!;
      const b = tickersWithData[j]!;
      const ra = returnsByTicker.get(a)!;
      const rb = returnsByTicker.get(b)!;
      // Align tail-to-tail (most recent N where N = min length).
      const n = Math.min(ra.length, rb.length);
      if (n < 3) continue;
      const xs = ra.slice(-n);
      const ys = rb.slice(-n);
      const corr = pearsonCorrelation(xs, ys);
      if (corr == null) continue;
      pairs.push({
        a,
        b,
        correlation: Math.round(corr * 1000) / 1000,
        sharedDays: n,
      });
    }
  }

  if (pairs.length === 0) {
    const result: CorrelationResult = {
      positionCount: openTrades.length,
      meanCorrelation: null,
      correlationLevel: "LOW",
      pairwiseCorrelations: [],
      mostCorrelatedPair: null,
      warning:
        "No valid correlation pairs (insufficient overlapping return history).",
      asOf: today,
      cached: false,
    };
    correlationCache.set(today, result);
    return { success: true, data: result };
  }

  const mean =
    pairs.reduce((s, p) => s + p.correlation, 0) / pairs.length;
  const meanCorrelation = Math.round(mean * 1000) / 1000;

  // "Most correlated pair" by absolute correlation (negative correlation can
  // also signal hedge/anti-hedge structure worth flagging).
  const mostCorrelatedPair = pairs.reduce((best, p) =>
    Math.abs(p.correlation) > Math.abs(best.correlation) ? p : best
  );

  let correlationLevel: CorrelationResult["correlationLevel"];
  const absMean = Math.abs(meanCorrelation);
  if (absMean < 0.3) correlationLevel = "LOW";
  else if (absMean < 0.5) correlationLevel = "MODERATE";
  else if (absMean < 0.7) correlationLevel = "HIGH";
  else correlationLevel = "EXTREME";

  let warning: string | null = null;
  if (correlationLevel === "HIGH") {
    warning =
      `Mean portfolio correlation ${meanCorrelation.toFixed(2)} is elevated. ` +
      `Most correlated pair: ${mostCorrelatedPair.a} ↔ ${mostCorrelatedPair.b} ` +
      `(${mostCorrelatedPair.correlation.toFixed(2)} over ${mostCorrelatedPair.sharedDays} days). ` +
      `Open positions are moving together more than sector labels suggest.`;
  } else if (correlationLevel === "EXTREME") {
    warning =
      `EXTREME correlation: mean ${meanCorrelation.toFixed(2)}. ` +
      `Most correlated pair: ${mostCorrelatedPair.a} ↔ ${mostCorrelatedPair.b} ` +
      `(${mostCorrelatedPair.correlation.toFixed(2)}). ` +
      `Do NOT add new positions in sectors already represented in the book — ` +
      `they will push correlation higher and concentrate risk.`;
  }

  const result: CorrelationResult = {
    positionCount: openTrades.length,
    meanCorrelation,
    correlationLevel,
    pairwiseCorrelations: pairs.sort(
      (a, b) => Math.abs(b.correlation) - Math.abs(a.correlation)
    ),
    mostCorrelatedPair,
    warning,
    asOf: today,
    cached: false,
  };

  correlationCache.set(today, result);
  return { success: true, data: result };
}

// ---------------------------------------------------------------------------
// curate_universe — monthly DB-only universe health review
// ---------------------------------------------------------------------------

interface CurationCandidate {
  symbol: string;
  sector: string | null;
  reason: string;
  lastQuoteAge: number | null; // days, or null if no quotes ever
  signalCount30d: number;
  executionCount: number;
  avgLiquidity: number | null;
  ageInUniverse: number; // days since Ticker.createdAt
}

const REMOVE_CAP = 20;
const REVIEW_CAP = 30;
const STALE_QUOTE_DAYS = 30;
const NO_SIGNAL_DAYS = 90;
const NEVER_TRADED_AGE_DAYS = 180;
const LOW_LIQUIDITY_THRESHOLD = 50_000;

async function handleCurateUniverse(): Promise<ToolResult> {
  const dbU = prisma as unknown as {
    ticker: {
      findMany: (args: unknown) => Promise<
        Array<{ id: number; symbol: string; sector: string | null; createdAt: Date }>
      >;
    };
    dailyQuote: {
      findFirst: (args: unknown) => Promise<{ date: Date } | null>;
      findMany: (args: unknown) => Promise<Array<{ volume: bigint }>>;
    };
    pendingOrder: {
      count: (args: unknown) => Promise<number>;
    };
    trade: {
      count: (args: unknown) => Promise<number>;
    };
  };

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86_400_000);

  const tickers = await dbU.ticker.findMany({
    where: { active: true },
    select: { id: true, symbol: true, sector: true, createdAt: true },
  } as unknown);

  const removeCandidates: CurationCandidate[] = [];
  const reviewCandidates: CurationCandidate[] = [];
  let healthyCount = 0;

  for (const t of tickers) {
    // lastQuoteAge
    const latest = await dbU.dailyQuote.findFirst({
      where: { tickerId: t.id },
      orderBy: { date: "desc" },
      select: { date: true },
    } as unknown);
    const lastQuoteAge = latest
      ? Math.floor((now.getTime() - latest.date.getTime()) / 86_400_000)
      : null;

    // signalCount30d
    const signalCount30d = await dbU.pendingOrder.count({
      where: { ticker: t.symbol, createdAt: { gte: thirtyDaysAgo } },
    } as unknown);

    // executionCount (lifetime)
    const executionCount = await dbU.trade.count({
      where: { ticker: t.symbol },
    } as unknown);

    // avgLiquidity (last 10 daily quotes)
    const recentQuotes = await dbU.dailyQuote.findMany({
      where: { tickerId: t.id },
      orderBy: { date: "desc" },
      take: 10,
      select: { volume: true },
    } as unknown);
    const avgLiquidity =
      recentQuotes.length > 0
        ? recentQuotes.reduce((s, q) => s + Number(q.volume), 0) /
          recentQuotes.length
        : null;

    const ageInUniverse = Math.floor(
      (now.getTime() - t.createdAt.getTime()) / 86_400_000,
    );

    const candidate: CurationCandidate = {
      symbol: t.symbol,
      sector: t.sector,
      reason: "",
      lastQuoteAge,
      signalCount30d,
      executionCount,
      avgLiquidity:
        avgLiquidity == null ? null : Math.round(avgLiquidity),
      ageInUniverse,
    };

    // REMOVE: stale quotes >30d (likely delisted or suspended)
    if (lastQuoteAge == null) {
      removeCandidates.push({
        ...candidate,
        reason: "No DailyQuote rows ever — never fetched or symbol invalid",
      });
      continue;
    }
    if (lastQuoteAge > STALE_QUOTE_DAYS) {
      removeCandidates.push({
        ...candidate,
        reason: `Last quote ${lastQuoteAge} days ago — likely delisted or suspended`,
      });
      continue;
    }

    // REVIEW: low liquidity
    if (avgLiquidity != null && avgLiquidity < LOW_LIQUIDITY_THRESHOLD) {
      reviewCandidates.push({
        ...candidate,
        reason: `Avg volume ${candidate.avgLiquidity?.toLocaleString()} shares/day < ${LOW_LIQUIDITY_THRESHOLD.toLocaleString()} threshold`,
      });
      continue;
    }

    // REVIEW: never signals (only meaningful if ticker has been around long
    // enough to have had the chance). Use NO_SIGNAL_DAYS as the floor.
    if (signalCount30d === 0 && ageInUniverse >= NO_SIGNAL_DAYS) {
      reviewCandidates.push({
        ...candidate,
        reason: `0 signals in last 30 days; ticker has been in universe ${ageInUniverse} days`,
      });
      continue;
    }

    // REVIEW: never traded despite long tenure
    if (executionCount === 0 && ageInUniverse >= NEVER_TRADED_AGE_DAYS) {
      reviewCandidates.push({
        ...candidate,
        reason: `Never executed a trade in ${ageInUniverse} days in universe`,
      });
      continue;
    }

    healthyCount++;
  }

  // Cap the lists. Sort REMOVE by lastQuoteAge desc (most stale first),
  // REVIEW by avgLiquidity asc (lowest liquidity first, with nulls last).
  removeCandidates.sort(
    (a, b) => (b.lastQuoteAge ?? 9999) - (a.lastQuoteAge ?? 9999),
  );
  reviewCandidates.sort((a, b) => {
    const av = a.avgLiquidity ?? Number.MAX_SAFE_INTEGER;
    const bv = b.avgLiquidity ?? Number.MAX_SAFE_INTEGER;
    return av - bv;
  });

  const cappedRemove = removeCandidates.slice(0, REMOVE_CAP);
  const cappedReview = reviewCandidates.slice(0, REVIEW_CAP);

  const totalRemove = removeCandidates.length;
  const totalReview = reviewCandidates.length;

  const summary =
    `Reviewed ${tickers.length} active tickers. ` +
    `${healthyCount} healthy, ${totalReview} flagged for review, ${totalRemove} flagged for removal. ` +
    `Showing top ${cappedRemove.length} remove and ${cappedReview.length} review candidates. ` +
    `ADVISORY ONLY — no tickers have been removed. Manual action required.`;

  return {
    success: true,
    data: {
      totalTickers: tickers.length,
      healthyCount,
      reviewCount: totalReview,
      removeCount: totalRemove,
      removeCandidates: cappedRemove,
      reviewCandidates: cappedReview,
      summary,
    },
  };
}

// ---------------------------------------------------------------------------
// get_last_curation_date — find most recent curate_universe call
// ---------------------------------------------------------------------------

async function handleGetLastCurationDate(): Promise<ToolResult> {
  const dbL = prisma as unknown as {
    agentDecisionLog: {
      findFirst: (args: unknown) => Promise<
        { cycleStartedAt: Date; actionsJson: string } | null
      >;
    };
  };

  // actionsJson is stored as String @db.Text — search via Prisma `contains`.
  const last = await dbL.agentDecisionLog.findFirst({
    where: { actionsJson: { contains: "curate_universe" } },
    orderBy: { cycleStartedAt: "desc" },
    select: { cycleStartedAt: true, actionsJson: true },
  } as unknown);

  if (!last) {
    return {
      success: true,
      data: { lastCurationDate: null, daysSinceLastCuration: Number.POSITIVE_INFINITY },
    };
  }

  const daysSince = Math.floor(
    (Date.now() - last.cycleStartedAt.getTime()) / 86_400_000,
  );

  return {
    success: true,
    data: {
      lastCurationDate: last.cycleStartedAt.toISOString(),
      daysSinceLastCuration: daysSince,
    },
  };
}


// ---------------------------------------------------------------------------
// trigger_opportunity_scan — fire an immediate scan when a slot opens up
// ---------------------------------------------------------------------------

async function handleTriggerOpportunityScan(baseUrl: string): Promise<ToolResult> {
  // GET /api/scan runs the full universe scan and writes any new PendingOrders.
  // The endpoint is rate-limited to 2/min — opportunistic use only.
  try {
    const res = await fetch(`${baseUrl}/api/scan`, {
      method: "GET",
      headers: agentHeaders(),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return { success: false, error: `Scan API error ${res.status}${detail ? `: ${detail.slice(0, 200)}` : ""}` };
    }
    const data: unknown = await res.json();
    const summary = (data as { summary?: unknown }).summary ?? null;
    return {
      success: true,
      data: {
        triggered: true,
        scanCompletedAt: new Date().toISOString(),
        summary,
      },
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return { success: false, error: `Opportunity scan failed: ${message}` };
  }
}
