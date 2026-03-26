import React from "react";
import type { SignalFired, EquityCurveData } from "./types";
import { pctChange, fmtPrice, fmtMoney, tickerCurrency, mono } from "./helpers";
import { MiniBar } from "./MiniBar";

export function SignalCard({
  signal,
  dryRun,
  onMarkPlaced,
  placing,
  equityCurve,
}: {
  signal: SignalFired;
  dryRun: boolean;
  onMarkPlaced: (signal: SignalFired) => void;
  placing: boolean;
  equityCurve?: EquityCurveData | null;
}) {
  const stopPct = pctChange(signal.suggestedEntry, signal.hardStop);
  const pos = signal.positionSize;
  const c = signal.currency ?? tickerCurrency(signal.ticker);
  const ra = signal.regimeAssessment;
  const cs = signal.compositeScore;
  const borderColor = ra
    ? ra.overallSignal === "STRONG" ? "var(--green)" : ra.overallSignal === "CAUTION" ? "var(--amber)" : "var(--red)"
    : "var(--green)";
  const gradeColor = cs
    ? cs.grade === "A" ? "#00ff88" : cs.grade === "B" ? "var(--green)" : cs.grade === "C" ? "var(--amber)" : "var(--red)"
    : "var(--dim)";
  return (
    <div className="bg-[#111] p-4 mb-3" style={{ border: `1px solid ${borderColor}` }}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-lg font-bold" style={{ ...mono, color: borderColor }}>
          🟢 SIGNAL — {signal.ticker}
        </p>
        {cs && (
          <span
            className="text-sm font-bold px-2 py-0.5 border rounded"
            style={{ ...mono, color: gradeColor, borderColor: gradeColor }}
          >
            GRADE: {cs.grade}
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs mb-3" style={mono}>
        <span className="text-[var(--dim)]">Entry</span>
        <span>{fmtPrice(signal.suggestedEntry, c)}</span>
        <span className="text-[var(--dim)]">Hard stop</span>
        <span className="text-[var(--red)]">{fmtPrice(signal.hardStop, c)} ({stopPct})</span>
        <span className="text-[var(--dim)]">Risk/share</span>
        <span>{fmtPrice(signal.riskPerShare, c)}</span>
        {pos && (
          <>
            <span className="text-[var(--dim)]">Shares</span>
            <span>
              {pos.shares >= 1 ? pos.shares : pos.shares.toFixed(4)}
              {pos.shares < 1 && (
                <span className="text-[var(--dim)] ml-1">(fractional)</span>
              )}
            </span>
            {pos.shares < 1 && (
              <>
                <span />
                <span className="text-[var(--dim)] text-[10px]">Trading 212 fractional order</span>
              </>
            )}
            <span className="text-[var(--dim)]">Total exposure</span>
            <span>{fmtPrice(pos.totalExposure, c)} ({(pos.exposurePercent * 100).toFixed(1)}%)</span>
            {pos.exposureWarning && (
              <>
                <span />
                <span className="text-[var(--amber)] text-[10px]">⚠ {pos.exposureWarning}</span>
              </>
            )}
            <span className="text-[var(--dim)]">Risk</span>
            <span className="text-[var(--red)]">{fmtPrice(pos.dollarRisk, c)} (2.0%)</span>
          </>
        )}
        <span className="text-[var(--dim)]">ATR20</span>
        <span>{fmtPrice(signal.atr20, c)}</span>
      </div>
      <div className="flex items-center gap-3 text-xs mb-3" style={mono}>
        <span className="text-[var(--dim)]">Volume ratio</span>
        <span className="text-[var(--green)]">{signal.volumeRatio.toFixed(1)}x</span>
        <MiniBar value={signal.volumeRatio} max={3} color="var(--green)" />
      </div>
      <div className="flex items-center gap-3 text-xs mb-4" style={mono}>
        <span className="text-[var(--dim)]">Range position</span>
        <span className="text-[var(--green)]">{(signal.rangePosition * 100).toFixed(0)}%</span>
        <MiniBar value={signal.rangePosition} max={1} color="var(--green)" />
      </div>
      {cs && (
        <div className="border-t border-[var(--border)] pt-3 mb-4 text-xs" style={mono}>
          <p className="text-[var(--dim)] font-semibold tracking-widest mb-2">─── COMPOSITE SCORE ───</p>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[var(--dim)]">Overall</span>
            <span style={{ color: gradeColor }} className="font-bold">{cs.total.toFixed(2)} / 1.00</span>
            <MiniBar value={cs.total} max={1} color={gradeColor} />
            <span style={{ color: gradeColor }}>Grade {cs.grade}</span>
          </div>
          <div className="grid grid-cols-[auto_auto_1fr_auto] gap-x-3 gap-y-1 text-[11px]">
            <span className="text-[var(--dim)]">Regime</span>
            <span>{cs.components.regimeScore.toFixed(2)} / 0.40</span>
            <MiniBar value={cs.components.regimeScore} max={0.40} color="var(--green)" />
            <span className="text-[var(--dim)]">{ra ? `${ra.score}/3` : ""}</span>
            <span className="text-[var(--dim)]">Trend</span>
            <span>{cs.components.trendScore.toFixed(2)} / 0.30</span>
            <MiniBar value={cs.components.trendScore} max={0.30} color="var(--green)" />
            <span className="text-[var(--dim)]">{ra?.tickerRegime.pctAboveMA50 != null ? `${ra.tickerRegime.pctAboveMA50 >= 0 ? "+" : ""}${ra.tickerRegime.pctAboveMA50.toFixed(0)}% MA` : ""}</span>
            <span className="text-[var(--dim)]">Volume</span>
            <span>{cs.components.volumeScore.toFixed(2)} / 0.20</span>
            <MiniBar value={cs.components.volumeScore} max={0.20} color="var(--green)" />
            <span className="text-[var(--dim)]">{signal.volumeRatio.toFixed(1)}x</span>
            <span className="text-[var(--dim)]">Liquidity</span>
            <span>{cs.components.liquidityScore.toFixed(2)} / 0.10</span>
            <MiniBar value={cs.components.liquidityScore} max={0.10} color="var(--green)" />
            <span className="text-[var(--dim)]">${(signal.avgDollarVolume20 / 1_000_000).toFixed(1)}M/day</span>
          </div>
          <p className="text-[var(--dim)] text-[10px] mt-2">{cs.gradeReason}</p>
        </div>
      )}
      {ra && (
        <div className="border-t border-[var(--border)] pt-3 mb-4 text-xs" style={mono}>
          <p className="text-[var(--dim)] font-semibold tracking-widest mb-2">─── REGIME ASSESSMENT ───</p>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
            <span className="text-[var(--dim)]">Market</span>
            <span style={{ color: ra.regime.marketRegime === "BULLISH" ? "var(--green)" : "var(--red)" }}>
              {ra.regime.marketRegime === "BULLISH" ? "✓" : "✗"} {ra.regime.marketRegime}  QQQ {ra.regime.qqqPctAboveMA >= 0 ? "+" : ""}{ra.regime.qqqPctAboveMA.toFixed(1)}% {ra.regime.qqqPctAboveMA >= 0 ? "above" : "below"} 200MA
            </span>
            <span className="text-[var(--dim)]">Volatility</span>
            <span style={{ color: ra.regime.volatilityRegime === "NORMAL" ? "var(--green)" : ra.regime.volatilityRegime === "PANIC" ? "var(--red)" : "var(--amber)" }}>
              {ra.regime.volatilityRegime === "NORMAL" ? "✓" : ra.regime.volatilityRegime === "PANIC" ? "✗" : "⚠"} {ra.regime.volatilityRegime}  VIX {ra.regime.vixLevel?.toFixed(1) ?? "—"}
            </span>
            <span className="text-[var(--dim)]">Ticker trend</span>
            <span style={{ color: ra.tickerRegime.tickerTrend === "UPTREND" ? "var(--green)" : ra.tickerRegime.tickerTrend === "DOWNTREND" ? "var(--red)" : "var(--dim)" }}>
              {ra.tickerRegime.tickerTrend === "UPTREND" ? "✓" : ra.tickerRegime.tickerTrend === "DOWNTREND" ? "✗" : "?"} {ra.tickerRegime.tickerTrend}  {ra.tickerRegime.ticker} {ra.tickerRegime.pctAboveMA50 != null ? `${ra.tickerRegime.pctAboveMA50 >= 0 ? "+" : ""}${ra.tickerRegime.pctAboveMA50.toFixed(1)}% ${ra.tickerRegime.pctAboveMA50 >= 0 ? "above" : "below"} 50MA` : ""}
            </span>
          </div>
          <div className="mt-2 pt-1">
            <span className="text-[var(--dim)]">Overall  </span>
            <span style={{ color: borderColor }}>
              {ra.overallSignal === "STRONG" ? "✅" : ra.overallSignal === "CAUTION" ? "⚠" : "🔴"} {ra.overallSignal} — {ra.score === 3 ? "all three layers green" : ra.score === 2 ? "1 of 3 regime layers flagged" : `${3 - ra.score} of 3 regime layers flagged`}
            </span>
            {ra.warnings.length > 0 && (
              <div className="mt-1 text-[10px]">
                {ra.warnings.map((w, i) => (
                  <p key={i} className="text-[var(--dim)]">↳ {w}</p>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
      {equityCurve && (
        <div className="border-t border-[var(--border)] pt-3 mb-4 text-xs" style={mono}>
          <p className="text-[var(--dim)] font-semibold tracking-widest mb-2">─── SYSTEM STATE ───</p>
          {equityCurve.systemState === "NORMAL" ? (
            <p className="text-[var(--green)]">✅ NORMAL — full {equityCurve.riskPctPerTrade.toFixed(1)}% risk active</p>
          ) : equityCurve.systemState === "CAUTION" ? (
            <div>
              <p className="text-[var(--amber)] mb-1">⚠ CAUTION — risk reduced to {equityCurve.riskPctPerTrade.toFixed(1)}%</p>
              <p className="text-[var(--dim)]">Peak: {fmtMoney(equityCurve.peakBalance)} | Current: {fmtMoney(equityCurve.currentBalance)} | Drawdown: {equityCurve.drawdownPct.toFixed(1)}%</p>
              <p className="text-[var(--dim)]">Max positions: {equityCurve.maxPositions} (reduced from 5)</p>
            </div>
          ) : (
            <div>
              <p className="text-[var(--red)] mb-1">🔴 PAUSED — account down {equityCurve.drawdownPct.toFixed(1)}% from peak</p>
              <p className="text-[var(--dim)]">No new entries until recovery. Manage existing positions only.</p>
              <p className="text-[var(--dim)]">Peak: {fmtMoney(equityCurve.peakBalance)} | Current: {fmtMoney(equityCurve.currentBalance)}</p>
            </div>
          )}
        </div>
      )}
      <button
        onClick={() => onMarkPlaced(signal)}
        disabled={dryRun || placing || !pos || equityCurve?.systemState === "PAUSE"}
        className={`w-full px-4 py-2 text-xs border font-semibold transition-colors ${
          dryRun || equityCurve?.systemState === "PAUSE"
            ? "border-[#333] text-[#555] cursor-not-allowed"
            : "border-[var(--amber)] text-[var(--amber)] hover:bg-[var(--amber)] hover:text-black"
        }`}
        style={mono}
        title={equityCurve?.systemState === "PAUSE" ? "System paused — manage exits only" : undefined}
      >
        {placing ? "SAVING…" : dryRun ? "DRY RUN — not written" : equityCurve?.systemState === "PAUSE" ? "PAUSED — exits only" : "MARK AS PLACED"}
      </button>
    </div>
  );
}
