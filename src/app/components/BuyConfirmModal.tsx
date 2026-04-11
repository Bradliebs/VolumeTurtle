import React, { useEffect, useState } from "react";
import type { SignalFired } from "./types";
import { fmtPrice, fmtMoney, tickerCurrency, mono } from "./helpers";

export function BuyConfirmModal({
  signal,
  onConfirm,
  onCancel,
  buying,
}: {
  signal: SignalFired;
  onConfirm: () => void;
  onCancel: () => void;
  buying: boolean;
}) {
  const c = signal.currency ?? tickerCurrency(signal.ticker);
  const pos = signal.positionSize;
  const shares = pos?.shares ?? 0;
  const exposure = pos?.totalExposure ?? 0;
  const risk = pos?.dollarRisk ?? 0;
  const stopPct = signal.suggestedEntry > 0
    ? (((signal.hardStop - signal.suggestedEntry) / signal.suggestedEntry) * 100).toFixed(1)
    : "0.0";

  // Sector concentration warning for manual entries
  const [sectorWarning, setSectorWarning] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const [settingsRes, tradesRes] = await Promise.all([
          fetch("/api/execution/settings"),
          fetch(`/api/dashboard`),
        ]);
        if (!settingsRes.ok || !tradesRes.ok) return;
        const settings = await settingsRes.json();
        const dashboard = await tradesRes.json();
        const maxPerSector = settings.maxPositionsPerSector ?? 2;
        const openTrades = (dashboard.openTrades ?? []) as Array<{ ticker: string; sector?: string | null }>;

        // Look up sector for this ticker from open trades or universe-derived data
        const tickerSector = openTrades.find((t) => t.ticker === signal.ticker)?.sector;
        if (!tickerSector) return;

        const sectorCount = openTrades.filter((t) => t.sector === tickerSector).length;
        if (sectorCount >= maxPerSector) {
          setSectorWarning(
            `You already have ${sectorCount} open ${tickerSector} position${sectorCount !== 1 ? "s" : ""} (limit: ${maxPerSector}). Adding this manually overrides the concentration limit.`,
          );
        }
      } catch { /* silent */ }
    })();
  }, [signal.ticker]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" aria-labelledby="buy-confirm-title">
      <div className="border border-[var(--red)] bg-[#111] p-6 w-full max-w-md">
        <h3 id="buy-confirm-title" className="text-lg font-semibold text-[var(--red)] mb-4" style={mono}>
          ⚠ CONFIRM BUY ORDER
        </h3>
        <p className="text-sm text-[var(--dim)] mb-4">
          This will place a <span className="text-white font-semibold">real market buy</span> order on Trading 212 and set a stop loss.
        </p>

        <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-xs mb-4" style={mono}>
          <span className="text-[var(--dim)]">Ticker</span>
          <span className="text-[var(--green)] font-bold text-sm">{signal.ticker}</span>

          <span className="text-[var(--dim)]">Shares</span>
          <span className="text-white">
            {shares >= 1 ? shares : shares.toFixed(4)}
            {shares < 1 && <span className="text-[var(--dim)] ml-1">(fractional)</span>}
          </span>

          <span className="text-[var(--dim)]">Entry (market)</span>
          <span className="text-white">≈ {fmtPrice(signal.suggestedEntry, c)}</span>

          <span className="text-[var(--dim)]">Hard stop</span>
          <span className="text-[var(--red)]">{fmtPrice(signal.hardStop, c)} ({stopPct}%)</span>

          <span className="text-[var(--dim)]">Exposure</span>
          <span className="text-white">{fmtMoney(exposure)}</span>

          <span className="text-[var(--dim)]">Risk (2%)</span>
          <span className="text-[var(--red)]">{fmtMoney(risk)}</span>

          {signal.compositeScore && (
            <>
              <span className="text-[var(--dim)]">Grade</span>
              <span className="font-bold" style={{
                color: signal.compositeScore.grade === "A" ? "#00ff88"
                  : signal.compositeScore.grade === "B" ? "var(--green)"
                  : signal.compositeScore.grade === "C" ? "var(--amber)"
                  : "var(--red)",
              }}>
                {signal.compositeScore.grade}
              </span>
            </>
          )}
        </div>

        {sectorWarning && (
          <div className="p-2 mb-4 border border-[var(--amber)]/40 bg-[var(--amber)]/10 text-[var(--amber)] text-[10px]" style={mono}>
            ⚠ {sectorWarning}
          </div>
        )}

        <p className="text-[10px] text-[var(--dim)] mb-6" style={mono}>
          Market orders fill at the current ask price which may differ from the suggested entry.
        </p>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            disabled={buying}
            className="px-4 py-2 text-sm border border-[#333] text-[var(--dim)] hover:text-white transition-colors disabled:opacity-50"
            style={mono}
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            disabled={buying}
            className="px-4 py-2 text-sm border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors font-semibold disabled:opacity-50"
            style={mono}
          >
            {buying ? "BUYING…" : "CONFIRM — BUY NOW"}
          </button>
        </div>
      </div>
    </div>
  );
}
