"use client";

import React from "react";
import { mono, fmtMoney } from "./helpers";
import type { Trade, TradeWithHistory } from "./types";

interface SyncEntry {
  t212?: {
    currentPrice: number;
    ppl: number;
    stopLoss: number | null;
    quantity?: number;
    averagePrice?: number;
  } | null;
  latestClose?: number | null;
}

interface PortfolioSummaryCardProps {
  openTrades: TradeWithHistory[];
  closedTrades: Trade[];
  syncData: Record<string, SyncEntry>;
  t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }>;
  gbpUsdRate: number;
}

export function PortfolioSummaryCard({
  openTrades,
  closedTrades,
  syncData,
  t212Prices,
  gbpUsdRate,
}: PortfolioSummaryCardProps) {
  const rate = gbpUsdRate;
  const isUsd = (ticker: string) =>
    !ticker.endsWith(".L") && !ticker.endsWith(".AS") && !ticker.endsWith(".HE") && !ticker.endsWith(".ST") && !ticker.endsWith(".CO");

  // ── Open P&L ──
  const unrealisedPnl = openTrades.reduce((sum, t) => {
    const sd = syncData[t.id];
    const t212 = sd?.t212 ?? (t212Prices[t.ticker] ? { ...t212Prices[t.ticker], quantity: t.shares, averagePrice: t.entryPrice } : null);
    const currentPrice = t212?.currentPrice ?? sd?.latestClose ?? null;
    const pnl = t212?.ppl ?? (currentPrice != null ? (currentPrice - t.entryPrice) * t.shares : 0);
    return sum + (isUsd(t.ticker) ? (pnl ?? 0) / rate : (pnl ?? 0));
  }, 0);

  // ── Market Value & Total Cost ──
  const marketValue = openTrades.reduce((sum, t) => {
    const sd = syncData[t.id];
    const t212 = sd?.t212 ?? (t212Prices[t.ticker] ? t212Prices[t.ticker] : null);
    const currentPrice = t212?.currentPrice ?? sd?.latestClose ?? t.entryPrice;
    const val = currentPrice * t.shares;
    return sum + (isUsd(t.ticker) ? val / rate : val);
  }, 0);

  const totalCost = openTrades.reduce((sum, t) => {
    const val = t.entryPrice * t.shares;
    return sum + (isUsd(t.ticker) ? val / rate : val);
  }, 0);

  // ── Win Rate ──
  const allTrades = [...openTrades, ...closedTrades];
  const totalTrades = allTrades.length;
  const closedWithResult = closedTrades.filter((t) => t.rMultiple != null);
  const wins = closedWithResult.filter((t) => (t.rMultiple ?? 0) > 0).length;
  const losses = closedWithResult.length - wins;
  const winPct = closedWithResult.length > 0 ? Math.round((wins / closedWithResult.length) * 100) : 0;

  // ── Max Profit / Max Loss ──
  const closedPnls = closedTrades
    .filter((t) => t.exitPrice != null)
    .map((t) => {
      const pl = (t.exitPrice! - t.entryPrice) * t.shares;
      return isUsd(t.ticker) ? pl / rate : pl;
    });
  const maxProfit = closedPnls.length > 0 ? Math.max(...closedPnls) : 0;
  const maxLoss = closedPnls.length > 0 ? Math.min(...closedPnls) : 0;

  // ── Donut chart ──
  const donutRadius = 36;
  const donutStroke = 7;
  const circ = 2 * Math.PI * donutRadius;
  const winArc = closedWithResult.length > 0 ? (wins / closedWithResult.length) * circ : 0;
  const lossArc = circ - winArc;

  return (
    <section className="mb-4">
      <div className="border border-[var(--border)] bg-[var(--card)] rounded-xl overflow-hidden">

        {/* ── Open P&L Header ── */}
        <div className="px-5 pt-4 pb-3 border-b border-[var(--border)]">
          <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">
            OPEN P&amp;L (CURRENT TRADES)
          </p>
          <div className="flex items-center gap-2" style={mono}>
            <span className={`text-xs ${unrealisedPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
              {unrealisedPnl >= 0 ? "▲" : "▼"}
            </span>
            <span className={`text-2xl font-bold ${unrealisedPnl >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>
              {unrealisedPnl >= 0 ? "" : "-"}£{Math.abs(unrealisedPnl).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </div>
        </div>

        {/* ── Market Value / Total Cost ── */}
        <div className="grid grid-cols-2 border-b border-[var(--border)]">
          <div className="px-5 py-3 border-r border-[var(--border)]">
            <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">MARKET VALUE</p>
            <p className="text-lg font-bold text-white" style={mono}>{fmtMoney(marketValue)}</p>
          </div>
          <div className="px-5 py-3">
            <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">TOTAL COST</p>
            <p className="text-lg font-bold text-white" style={mono}>{fmtMoney(totalCost)}</p>
          </div>
        </div>

        {/* ── Win Rate Donut ── */}
        <div className="flex items-center gap-5 px-5 py-4 border-b border-[var(--border)]">
          <div className="relative flex-shrink-0">
            <svg width="88" height="88" viewBox="0 0 88 88" className="-rotate-90">
              {/* Background ring */}
              <circle
                cx="44" cy="44" r={donutRadius}
                fill="none"
                stroke="var(--border)"
                strokeWidth={donutStroke}
              />
              {/* Win arc (green) */}
              <circle
                cx="44" cy="44" r={donutRadius}
                fill="none"
                stroke="var(--green)"
                strokeWidth={donutStroke}
                strokeDasharray={`${winArc} ${circ}`}
                strokeLinecap="round"
              />
              {/* Loss arc (red) */}
              {losses > 0 && (
                <circle
                  cx="44" cy="44" r={donutRadius}
                  fill="none"
                  stroke="var(--red)"
                  strokeWidth={donutStroke}
                  strokeDasharray={`${lossArc} ${circ}`}
                  strokeDashoffset={-winArc}
                  strokeLinecap="round"
                />
              )}
            </svg>
            {/* Center label */}
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-sm font-bold text-white" style={mono}>{winPct}%</span>
            </div>
          </div>
          <div>
            <p className="text-sm font-semibold text-white mb-1">Win Rate</p>
            <p className="text-xs text-[var(--green)]">● {wins} Win{wins !== 1 ? "s" : ""}</p>
            <p className="text-xs text-[var(--red)]">● {losses} Loss{losses !== 1 ? "es" : ""}</p>
          </div>
        </div>

        {/* ── Max Profit / Max Loss ── */}
        <div className="grid grid-cols-2 border-b border-[var(--border)]">
          <div className="px-5 py-3 border-r border-[var(--border)]">
            <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">MAX PROFIT</p>
            <p className="text-lg font-bold text-[var(--green)]" style={mono}>
              £{maxProfit.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
          <div className="px-5 py-3">
            <p className="text-[10px] text-[var(--dim)] tracking-widest mb-1">MAX LOSS</p>
            <p className="text-lg font-bold text-[var(--red)]" style={mono}>
              -£{Math.abs(maxLoss).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
          </div>
        </div>

        {/* ── Total Trades / Open ── */}
        <div className="grid grid-cols-2">
          <div className="flex items-center gap-2 px-5 py-3 border-r border-[var(--border)]">
            <span className="text-base">📊</span>
            <div>
              <p className="text-sm font-semibold text-white" style={mono}>{totalTrades} Trade{totalTrades !== 1 ? "s" : ""}</p>
            </div>
          </div>
          <div className="flex items-center gap-2 px-5 py-3">
            <span className="text-base">📂</span>
            <div>
              <p className="text-sm font-semibold text-white" style={mono}>{openTrades.length} Open</p>
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
