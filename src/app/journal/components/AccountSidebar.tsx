"use client";

import { useState } from "react";
import type { JournalTrade, AccountMetrics } from "../types";

interface Props {
  account: AccountMetrics;
  openTrades: JournalTrade[];
  closedTrades: JournalTrade[];
}

function formatDateRange(entry: string, exit: string | null): string {
  const fmt = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString("en-GB", {
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };
  if (!exit) return `${fmt(entry)} — Present`;
  return `${fmt(entry)} — ${fmt(exit)}`;
}

function TradeRow({ trade }: { trade: JournalTrade }) {
  const isPositive = (trade.rr ?? 0) >= 0;
  const color = isPositive ? "var(--green)" : "var(--red)";

  return (
    <div className="flex items-start justify-between py-3 border-b border-[var(--border)] last:border-b-0 gap-3">
      <div className="flex flex-col gap-0.5 min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span
            className="font-bold text-white text-sm"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {trade.ticker}
          </span>
          <span
            className="text-[9px] font-bold px-1.5 py-0.5 rounded"
            style={{
              backgroundColor: "rgba(0, 255, 136, 0.15)",
              color: "var(--green)",
              fontFamily: "'JetBrains Mono', monospace",
            }}
          >
            LONG
          </span>
          {trade.signalGrade && (
            <span
              className="text-[9px] font-bold px-1.5 py-0.5 rounded"
              style={{
                backgroundColor:
                  trade.signalGrade === "A"
                    ? "rgba(0, 255, 136, 0.15)"
                    : trade.signalGrade === "B"
                      ? "rgba(245, 166, 35, 0.15)"
                      : "rgba(255, 68, 68, 0.12)",
                color:
                  trade.signalGrade === "A"
                    ? "var(--green)"
                    : trade.signalGrade === "B"
                      ? "var(--amber)"
                      : "var(--red)",
                fontFamily: "'JetBrains Mono', monospace",
              }}
            >
              {trade.signalGrade}
            </span>
          )}
        </div>
        <span className="text-[10px] text-[var(--dim)]">{trade.strategy}</span>
        <span className="text-[9px] text-[var(--dim)] opacity-70">
          {formatDateRange(trade.entryDate, trade.exitDate)}
        </span>
      </div>

      <div
        className="flex flex-col items-end gap-0.5 shrink-0"
        style={{ fontFamily: "'JetBrains Mono', monospace" }}
      >
        {trade.rr != null && (
          <span
            className="text-sm font-bold"
            style={{ color }}
          >
            {isPositive ? "+" : ""}
            {trade.rr.toFixed(2)}{" "}
            <span className="text-[10px] text-[var(--dim)]">R:R</span>
          </span>
        )}
        <span className="text-[10px]" style={{ color }}>
          {(trade.pctReturn ?? 0) >= 0 ? "+" : ""}
          {(trade.pctReturn ?? 0).toFixed(2)} %
        </span>
        <span className="text-xs font-semibold" style={{ color }}>
          {(trade.profitGBP ?? 0) >= 0 ? "+" : "-"}£
          {Math.abs(trade.profitGBP ?? 0).toLocaleString("en-GB", {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2,
          })}
        </span>
      </div>
    </div>
  );
}

export function AccountSidebar({ account, openTrades, closedTrades }: Props) {
  const [tab, setTab] = useState<"OPEN" | "CLOSED">("CLOSED");

  const trades = tab === "OPEN" ? openTrades : closedTrades;

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl flex flex-col h-full">
      {/* Account metrics header */}
      <div className="p-5 border-b border-[var(--border)]">
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs text-[var(--dim)]">Account Balance</span>
          <span
            className="text-lg font-bold text-[var(--green)]"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            £
            {account.balance.toLocaleString("en-GB", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
        <div className="flex items-center justify-between text-xs mb-1">
          <span className="text-[var(--dim)]">Trade Risk</span>
          <span
            className="text-white font-semibold"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            {account.tradeRisk}%
          </span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-[var(--dim)]">Risk Value</span>
          <span
            className="text-white font-semibold"
            style={{ fontFamily: "'JetBrains Mono', monospace" }}
          >
            £
            {account.riskValue.toLocaleString("en-GB", {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
          </span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        <button
          onClick={() => setTab("OPEN")}
          className={`flex-1 py-2.5 text-xs font-semibold tracking-wider transition-colors ${
            tab === "OPEN"
              ? "text-[var(--green)] border-b-2 border-[var(--green)]"
              : "text-[var(--dim)] hover:text-white"
          }`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          OPEN
        </button>
        <button
          onClick={() => setTab("CLOSED")}
          className={`flex-1 py-2.5 text-xs font-semibold tracking-wider transition-colors ${
            tab === "CLOSED"
              ? "text-[var(--green)] border-b-2 border-[var(--green)]"
              : "text-[var(--dim)] hover:text-white"
          }`}
          style={{ fontFamily: "'JetBrains Mono', monospace" }}
        >
          CLOSED
        </button>
      </div>

      {/* Trade list */}
      <div className="flex-1 overflow-y-auto px-4 py-2 max-h-[600px]">
        {trades.length > 0 ? (
          trades.map((t) => <TradeRow key={t.id} trade={t} />)
        ) : (
          <div className="text-center text-[var(--dim)] text-sm py-8">
            No {tab.toLowerCase()} trades
          </div>
        )}
      </div>
    </div>
  );
}
