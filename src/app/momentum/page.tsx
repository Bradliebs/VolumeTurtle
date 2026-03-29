"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { mono, fmtDate } from "../components/helpers";
import { GradeBadge } from "../components/GradeBadge";
import { AlertPanel } from "../components/AlertPanel";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SectorRow {
  id: number; sector: string; score: number; R5: number; R20: number;
  volRatio: number; tickerCount: number; hotCount: number; ma5AboveMa20: boolean;
}

interface MomentumSignalRow {
  id: number; ticker: string; sector: string; chg1d: number; volRatio: number;
  R5: number; R20: number; price: number; compositeScore: number; grade: string;
  regimeScore: number; tickerTrend: string; sectorScore: number; sectorRank: number;
  status: string; createdAt: string; stopPrice: number; atr: number;
}

interface RegimeInfo {
  marketRegime: string | null; regimeScore: number | null; regimeAssessment: string | null;
  vixLevel: string | null; vixValue: number | null; qqqVs200MA: number | null;
  scanRunAt: string | null;
}

interface SizeResult {
  balance: number; shares: number; dollarRisk: number; riskPct: number;
  totalExposure: number; exposurePct: number; systemState: string; reason: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getMarketContext(): "OPEN" | "PRE" | "AFTER" | "CLOSED" {
  const now = new Date();
  const day = now.getUTCDay();
  if (day === 0 || day === 6) return "CLOSED";
  const h = now.getUTCHours();
  const m = now.getUTCMinutes();
  const t = h * 60 + m;
  if (t >= 870 && t < 1260) return "OPEN";   // 14:30-21:00 UTC
  if (t >= 780 && t < 870) return "PRE";      // 13:00-14:30 UTC
  if (t >= 1260 && t < 1500) return "AFTER";  // 21:00-01:00 UTC
  return "CLOSED";
}

function signalAge(createdAt: string): { label: string; color: string; level: string } {
  const ms = Date.now() - new Date(createdAt).getTime();
  const hours = ms / 3600_000;
  if (hours < 4) return { label: `${Math.round(hours)}h ago`, color: "var(--green)", level: "FRESH" };
  if (hours < 24) return { label: `${Math.round(hours)}h ago`, color: "var(--amber)", level: "TODAY" };
  const days = Math.round(hours / 24);
  return { label: `${days}d ago`, color: "var(--red)", level: "STALE" };
}

function computeStop(signal: MomentumSignalRow): { price: number; isFallback: boolean } {
  if (signal.atr > 0) return { price: signal.price - 1.5 * signal.atr, isFallback: false };
  return { price: signal.price * 0.92, isFallback: true };
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ScoreBar({ label, value, max }: { label: string; value: number; max: number }) {
  const pct = Math.min(100, (value / Math.max(max, 0.01)) * 100);
  const color = value >= max * 0.7 ? "var(--green)" : value >= max * 0.3 ? "var(--amber)" : "var(--red)";
  return (
    <div className="flex items-center gap-2 text-[10px]">
      <span className="text-[var(--dim)] w-14 shrink-0">{label}</span>
      <div className="w-[60px] h-1 bg-[#222] rounded overflow-hidden shrink-0">
        <div className="h-full rounded" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="text-[var(--dim)] w-8">{value.toFixed(2)}</span>
    </div>
  );
}

function RegimeDisplay({ regime, tickerTrend }: { regime: RegimeInfo | null; tickerTrend: string }) {
  const mr = regime?.marketRegime;
  const vix = regime?.vixValue;
  const vixLabel = vix != null ? (vix < 20 ? "NORMAL" : vix < 30 ? "ELEVATED" : "PANIC") : null;
  const qqqUp = mr === "BULLISH";
  const vixOk = vix != null ? vix < 25 : null;
  const trendUp = tickerTrend === "UPTREND";
  const trendDown = tickerTrend === "DOWNTREND";

  return (
    <span className="flex items-center gap-1.5 flex-wrap text-[10px]">
      <span style={{ color: mr == null ? "var(--dim)" : qqqUp ? "var(--green)" : "var(--red)" }}>
        {"QQQ:"}{mr == null ? "\u2014" : qqqUp ? "\u25B2" : "\u25BC"}
      </span>
      <span style={{ color: vixOk == null ? "var(--dim)" : vixOk ? "var(--green)" : "var(--red)" }}>
        {"VIX:"}{vix == null ? "\u2014" : vixOk ? "\u25B2" : "\u25BC"}{vix != null ? ` ${vix.toFixed(0)}` : ""}
      </span>
      <span style={{ color: trendUp ? "var(--green)" : trendDown ? "var(--red)" : "var(--dim)" }}>
        {"TREND:"}{trendUp ? "\u25B2" : trendDown ? "\u25BC" : "\u2014"}
      </span>
    </span>
  );
}

function SignalAgeBadge({ createdAt }: { createdAt: string }) {
  const age = signalAge(createdAt);
  return (
    <span className="text-[9px] px-1 py-0 rounded-sm border" style={{
      color: age.color,
      borderColor: age.color,
      opacity: age.level === "STALE" ? 1 : 0.7,
    }}>
      {age.level} {age.label}
    </span>
  );
}

function MarketContextHint({ signal }: { signal: MomentumSignalRow }) {
  const ctx = getMarketContext();
  const age = signalAge(signal.createdAt);

  return (
    <div className="text-[10px] text-[var(--dim)] space-y-0.5">
      {ctx === "OPEN" && (
        <p>Signal price &mdash; enter your actual fill price</p>
      )}
      {ctx === "PRE" && (
        <>
          <p>Signal close price &mdash; market opens ~09:30 EST</p>
          <p className="text-[var(--amber)]">TIP: Buy within first 30 min if price holds above ${signal.price.toFixed(2)}</p>
        </>
      )}
      {ctx === "AFTER" && (
        <p>After-hours &mdash; update with tomorrow&apos;s open price</p>
      )}
      {ctx === "CLOSED" && (
        <>
          <p>Market closed &mdash; enter tomorrow&apos;s open price when you trade</p>
          {age.level === "STALE" && (
            <p className="text-[var(--amber)]">{"\u26A0"} SIGNAL IS {age.label.toUpperCase()} &mdash; re-validate before entering</p>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function MomentumPage() {
  const [sectors, setSectors] = useState<SectorRow[]>([]);
  const [signals, setSignals] = useState<MomentumSignalRow[]>([]);
  const [nearMisses, setNearMisses] = useState<MomentumSignalRow[]>([]);
  const [regime, setRegime] = useState<RegimeInfo | null>(null);
  const [runAt, setRunAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSector, setExpandedSector] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<string | null>(null);

  const [entryTicker, setEntryTicker] = useState<string | null>(null);
  const [entryPrice, setEntryPrice] = useState("");
  const [trailingStop, setTrailingStop] = useState("");
  const [quantity, setQuantity] = useState("");
  const [entryNotes, setEntryNotes] = useState("");
  const [sizeResult, setSizeResult] = useState<SizeResult | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [addedTickers, setAddedTickers] = useState<Set<string>>(new Set());
  const [flashMsg, setFlashMsg] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const [sectorsRes, signalsRes] = await Promise.all([
        fetch("/api/momentum/sectors"),
        fetch("/api/momentum/signals?status=all"),
      ]);
      if (sectorsRes.ok) {
        const d = await sectorsRes.json();
        setSectors(d.sectors ?? []);
        setRunAt(d.runAt);
        if (d.regime) setRegime(d.regime);
      }
      if (signalsRes.ok) {
        const d = await signalsRes.json();
        setSignals((d.signals ?? []).filter((s: MomentumSignalRow) => s.status === "active"));
        setNearMisses((d.nearMisses ?? []).filter((s: MomentumSignalRow) => s.status === "near-miss"));
        if (d.regime) setRegime(d.regime);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  async function runMomentumScan() {
    setScanning(true);
    setScanResult(null);
    try {
      const res = await fetch("/api/momentum/scan", { method: "POST" });
      if (res.ok) {
        const d = await res.json();
        const t = d.timing ?? {};
        setScanResult(
          `Done: ${d.tickersWithData}/${d.universeSize} tickers \u00B7 ` +
          `${d.sectorsRanked} sectors \u00B7 ${d.signalCount} signals \u00B7 ` +
          `${d.nearMissCount} near misses \u2014 ${d.durationMs}ms ` +
          `(regime ${t.regimeMs}ms, quotes ${t.quotesMs}ms, engines ${t.enginesMs}ms)`
        );
        fetchData();
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        setScanResult(`Error: ${d.error ?? "scan failed"}`);
      }
    } catch {
      setScanResult("Error: network failure");
    }
    setScanning(false);
  }

  function openEntryPanel(s: MomentumSignalRow) {
    const { price: hs } = computeStop(s);
    setEntryTicker(s.ticker);
    setEntryPrice(s.price.toFixed(2));
    setTrailingStop(hs.toFixed(2));
    setQuantity("");
    setEntryNotes("");
    setSizeResult(null);
    fetchSize(s.price, hs);
  }

  function closeEntryPanel() {
    setEntryTicker(null);
    setSizeResult(null);
  }

  async function fetchSize(entry: number, stop: number) {
    if (entry <= 0 || stop <= 0 || stop >= entry) return;
    try {
      const res = await fetch(`/api/account/size?entry=${entry}&stop=${stop}`);
      if (res.ok) {
        const d: SizeResult = await res.json();
        setSizeResult(d);
        setQuantity(String(d.shares));
      }
    } catch { /* silent */ }
  }

  async function confirmAdd(signal: MomentumSignalRow) {
    setSubmitting(true);
    const ep = parseFloat(entryPrice);
    const { price: hs } = computeStop(signal);
    const qty = parseFloat(quantity);
    try {
      const res = await fetch("/api/trades", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: signal.ticker,
          suggestedEntry: ep,
          hardStop: hs,
          shares: qty,
          signalSource: "momentum",
          signalScore: signal.compositeScore,
          signalGrade: signal.grade,
        }),
      });
      if (res.ok) {
        setAddedTickers(prev => new Set(prev).add(signal.ticker));
        setEntryTicker(null);
        setFlashMsg(`${signal.ticker} added to portfolio`);
        setTimeout(() => setFlashMsg(null), 4000);
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        alert(d.error ?? "Failed to add trade");
      }
    } catch {
      alert("Network error");
    }
    setSubmitting(false);
  }

  const gc = (g: string) =>
    g === "A" ? "#00ff88" : g === "B" ? "#66cc66" : g === "C" ? "var(--amber)" : "var(--red)";

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <main className="min-h-screen p-4 max-w-[1400px] mx-auto">
      {flashMsg && (
        <div className="fixed top-4 right-4 z-50 px-4 py-2 text-xs text-black bg-[var(--green)] font-bold" style={mono}>{flashMsg}</div>
      )}

      {/* Header */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]" style={mono}>VolumeTurtle</h1>
        <nav className="flex items-center gap-4 text-sm mr-2" style={mono}>
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">MOMENTUM</span>
          <Link href="/watchlist" className="text-[var(--dim)] hover:text-white transition-colors">WATCHLIST</Link>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
        <AlertPanel />
        <div className="ml-auto flex items-center gap-3">
          {runAt && <span className="text-xs text-[var(--dim)]" style={mono}>Last run: {fmtDate(runAt)}</span>}
          <button onClick={runMomentumScan} disabled={scanning}
            className="px-3 py-1 text-xs border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors disabled:opacity-50" style={mono}>
            {scanning ? "SCANNING\u2026" : "\u25B6 RUN MOMENTUM SCAN"}
          </button>
        </div>
      </header>

      {scanResult && (
        <div className="mb-4 px-3 py-2 text-xs border border-[var(--border)] bg-[var(--card)]" style={mono}>{scanResult}</div>
      )}

      {/* Regime bar */}
      {regime && regime.marketRegime && (
        <div className="mb-6 px-4 py-2 border border-[var(--border)] text-xs flex items-center gap-4" style={{
          background: regime.marketRegime === "BULLISH" ? "#001a00" : "#1a0000", ...mono,
        }}>
          <span className={regime.marketRegime === "BULLISH" ? "text-[var(--green)]" : "text-[var(--red)]"}>
            {regime.marketRegime === "BULLISH" ? "\u25B2" : "\u25BC"} {regime.marketRegime}
          </span>
          {regime.regimeScore != null && <span className="text-[var(--dim)]">Score: {regime.regimeScore}/3</span>}
          {regime.vixValue != null && (
            <span className="text-[var(--dim)]">VIX: {regime.vixValue.toFixed(1)}</span>
          )}
          {regime.qqqVs200MA != null && (
            <span className="text-[var(--dim)]">QQQ vs 200MA: {regime.qqqVs200MA >= 0 ? "+" : ""}{regime.qqqVs200MA.toFixed(1)}%</span>
          )}
        </div>
      )}

      {/* Two-column layout */}
      <div className="grid grid-cols-1 lg:grid-cols-[3fr_2fr] gap-6">

        {/* LEFT: Sector table */}
        <section>
          <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">SECTOR MOMENTUM</h2>
          <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
            <table className="w-full text-sm" style={mono}>
              <thead>
                <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                  <th className="text-center px-2 py-2 w-10">RNK</th>
                  <th className="text-left px-3 py-2">SECTOR</th>
                  <th className="text-right px-3 py-2">SCORE</th>
                  <th className="text-right px-3 py-2">R5%</th>
                  <th className="text-right px-3 py-2">R20%</th>
                  <th className="text-right px-3 py-2">VOL</th>
                  <th className="text-center px-2 py-2">{"MA5>MA20"}</th>
                  <th className="text-right px-2 py-2">TICKERS</th>
                  <th className="text-right px-2 py-2">HOT</th>
                  <th className="text-center px-2 py-2">SIG</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-[var(--dim)] text-xs">Loading&hellip;</td></tr>
                ) : sectors.length === 0 ? (
                  <tr><td colSpan={10} className="px-3 py-6 text-center text-[var(--dim)] text-xs">No sector data &mdash; run a momentum scan</td></tr>
                ) : sectors.map((s, i) => {
                  const isHot = i < 5;
                  const hasSignals = signals.some(sig => sig.sector === s.sector);
                  return (
                    <React.Fragment key={s.id}>
                      <tr className={`border-b border-[var(--border)] hover:bg-[#1a1a1a] cursor-pointer ${isHot ? "" : "opacity-60"}`}
                        onClick={() => setExpandedSector(expandedSector === s.sector ? null : s.sector)}>
                        <td className="text-center px-2 py-2 text-[var(--dim)]">{i + 1}</td>
                        <td className="px-3 py-2 font-semibold text-white">{s.sector}{isHot && <span className="text-[var(--green)] text-[9px] ml-1">HOT</span>}</td>
                        <td className="px-3 py-2 text-right font-bold" style={{ color: s.score > 0.8 ? "#00ff88" : s.score > 0.5 ? "var(--green)" : "var(--dim)" }}>{s.score.toFixed(2)}</td>
                        <td className={`px-3 py-2 text-right ${s.R5 >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{(s.R5 * 100).toFixed(1)}%</td>
                        <td className={`px-3 py-2 text-right ${s.R20 >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{(s.R20 * 100).toFixed(1)}%</td>
                        <td className="px-3 py-2 text-right text-[var(--dim)]">{s.volRatio.toFixed(1)}&times;</td>
                        <td className="px-2 py-2 text-center">{s.ma5AboveMa20 ? <span className="text-[var(--green)]">{"\u2713"}</span> : <span className="text-[var(--dim)]">&mdash;</span>}</td>
                        <td className="px-2 py-2 text-right text-[var(--dim)]">{s.tickerCount}</td>
                        <td className="px-2 py-2 text-right text-[var(--dim)]">{s.hotCount}</td>
                        <td className="px-2 py-2 text-center">{hasSignals ? <span className="text-[var(--green)] font-bold">{"\u25CF"}</span> : <span className="text-[#333]">{"\u25CB"}</span>}</td>
                      </tr>
                      {expandedSector === s.sector && (
                        <tr><td colSpan={10} className="px-3 py-3 bg-[#0d0d0d]">
                          <p className="text-xs text-[var(--dim)] mb-2 font-semibold tracking-widest">SIGNALS IN {s.sector.toUpperCase()}</p>
                          {signals.filter(sig => sig.sector === s.sector).length === 0 ? (
                            <p className="text-xs text-[var(--dim)]">No breakout signals in this sector</p>
                          ) : (
                            <div className="space-y-2">{signals.filter(sig => sig.sector === s.sector).map(sig => (
                              <div key={sig.id} className="flex items-center gap-3 text-xs border border-[var(--border)] p-2">
                                <GradeBadge grade={sig.grade} />
                                <span className="font-bold text-white">{sig.ticker}</span>
                                <span className={sig.chg1d >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>{sig.chg1d >= 0 ? "+" : ""}{(sig.chg1d * 100).toFixed(1)}%</span>
                                <span className="text-[var(--dim)]">{sig.volRatio.toFixed(1)}&times; vol</span>
                                <span className="text-[var(--dim)] ml-auto">{sig.compositeScore.toFixed(2)}</span>
                              </div>
                            ))}</div>
                          )}
                        </td></tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* RIGHT: Signals + Near misses */}
        <div className="space-y-6">

          {/* Signals */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">
              MOMENTUM SIGNALS{signals.length > 0 && <span className="text-white ml-2">{signals.length}</span>}
            </h2>
            <div className="space-y-2">
              {loading ? (
                <div className="border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--dim)]" style={mono}>Loading&hellip;</div>
              ) : signals.length === 0 ? (
                <div className="border border-[var(--border)] bg-[var(--card)] p-4 text-xs text-[var(--dim)]" style={mono}>No breakout signals today</div>
              ) : signals.map(s => {
                const isAdded = addedTickers.has(s.ticker);
                const isExpanded = entryTicker === s.ticker;
                const stop = computeStop(s);
                const rComp = 0.35 * (s.regimeScore / 3);
                const bComp = Math.max(0, s.compositeScore - rComp - s.sectorScore - 0.02);

                return (
                  <div key={s.id} style={mono}>
                    {/* Signal card */}
                    <div className="border border-[var(--border)] bg-[var(--card)] p-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 min-w-0">
                          {/* Header row */}
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-white text-sm">{s.ticker}</span>
                            <span className="px-1.5 py-0 text-[9px] rounded-sm border border-purple-500/30 text-purple-400 bg-purple-950/20">{s.sector}</span>
                            <SignalAgeBadge createdAt={s.createdAt} />
                          </div>
                          {/* Data grid */}
                          <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs mt-2">
                            <span className="text-[var(--dim)]">CHG 1D</span>
                            <span className={s.chg1d >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}>{s.chg1d >= 0 ? "+" : ""}{(s.chg1d * 100).toFixed(1)}%</span>
                            <span className="text-[var(--dim)]">Vol ratio</span>
                            <span className="text-white">{s.volRatio.toFixed(1)}&times;</span>
                            <span className="text-[var(--dim)]">Price</span>
                            <span className="text-white">${s.price.toFixed(2)}</span>
                            <span className="text-[var(--dim)]">Regime</span>
                            <RegimeDisplay regime={regime} tickerTrend={s.tickerTrend} />
                            <span className="text-[var(--dim)]">Stop (ATR 1.5&times;)</span>
                            {stop.isFallback ? (
                              <span className="text-[var(--amber)] text-[10px]">~${stop.price.toFixed(2)} (8% fallback)</span>
                            ) : (
                              <span className="text-[var(--red)]">${stop.price.toFixed(2)}</span>
                            )}
                          </div>
                          {/* Score breakdown */}
                          <div className="mt-2 space-y-0.5">
                            <ScoreBar label="REGIME" value={rComp} max={0.35} />
                            <ScoreBar label="BRKOUT" value={bComp} max={0.30} />
                            <ScoreBar label="SECTOR" value={s.sectorScore} max={0.25} />
                            <ScoreBar label="LIQUID" value={Math.max(0.02, s.compositeScore - bComp - rComp - s.sectorScore)} max={0.10} />
                            <div className="flex items-center gap-2 text-[10px] pt-0.5 border-t border-[var(--border)]">
                              <span className="text-[var(--dim)] w-14 shrink-0">TOTAL</span>
                              <span className="font-bold" style={{ color: gc(s.grade) }}>{s.compositeScore.toFixed(2)}</span>
                              <GradeBadge grade={s.grade} size="sm" />
                            </div>
                          </div>
                        </div>
                        {/* Right side: grade + button */}
                        <div className="flex flex-col items-center gap-2 shrink-0">
                          <GradeBadge grade={s.grade} size="lg" />
                          {isAdded ? (
                            <span className="text-[9px] text-[var(--green)] font-bold">{"\u2713"} ADDED</span>
                          ) : (
                            <button onClick={() => isExpanded ? closeEntryPanel() : openEntryPanel(s)}
                              className="px-2 py-1 text-[9px] border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors whitespace-nowrap">
                              {isExpanded ? "\u2715 CANCEL" : "\u25B6 ADD"}
                            </button>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Entry panel */}
                    {isExpanded && (
                      <div className="border border-[var(--green)]/30 border-t-0 bg-[#0a0f0a] p-4 space-y-3 text-xs">
                        {/* ATR warning */}
                        {stop.isFallback && (
                          <div className="px-3 py-2 border border-[var(--amber)]/40 bg-[#1a1400] text-[var(--amber)] text-[10px]">
                            {"\u26A0"} ATR UNAVAILABLE &mdash; stop is estimated at 8%. Review manually before placing.
                          </div>
                        )}
                        {/* Entry price + context */}
                        <div className="flex items-center gap-3">
                          <span className="text-[var(--dim)] w-24 shrink-0">ENTRY PRICE</span>
                          <input type="number" step="0.01" value={entryPrice}
                            onChange={e => { setEntryPrice(e.target.value); const ep = parseFloat(e.target.value); if (ep > 0 && stop.price > 0 && stop.price < ep) fetchSize(ep, stop.price); }}
                            className="w-28 px-2 py-1 bg-[#0a0a0a] border border-[var(--border)] text-white text-right" style={mono} />
                          <span className="text-[var(--dim)] text-[10px]">Signal: ${s.price.toFixed(2)}</span>
                        </div>
                        <div className="ml-24 pl-3">
                          <MarketContextHint signal={s} />
                        </div>
                        {/* Hard stop */}
                        <div className="flex items-center gap-3">
                          <span className="text-[var(--dim)] w-24 shrink-0">HARD STOP</span>
                          <span className={`w-28 px-2 py-1 text-right font-bold ${stop.isFallback ? "text-[var(--amber)]" : "text-[var(--red)]"}`}>
                            ${stop.price.toFixed(2)}
                          </span>
                          <span className="text-[var(--dim)] text-[10px]">
                            {stop.isFallback ? "8% fallback" : "ATR 1.5\u00D7"} &mdash; do not move down
                          </span>
                        </div>
                        {/* Trailing stop */}
                        <div className="flex items-center gap-3">
                          <span className="text-[var(--dim)] w-24 shrink-0">TRAILING STOP</span>
                          <input type="number" step="0.01" value={trailingStop} onChange={e => setTrailingStop(e.target.value)}
                            className="w-28 px-2 py-1 bg-[#0a0a0a] border border-[var(--border)] text-[var(--amber)] text-right" style={mono} />
                          <span className="text-[var(--dim)] text-[10px]">Ratchets up only after entry</span>
                        </div>
                        {/* Position size */}
                        {sizeResult && (
                          <div className="flex items-center gap-3">
                            <span className="text-[var(--dim)] w-24 shrink-0">SUGGESTED</span>
                            <span className="text-white">
                              {sizeResult.shares} shares &middot; RISK: &pound;{sizeResult.dollarRisk.toFixed(0)} ({sizeResult.riskPct.toFixed(1)}% of &pound;{sizeResult.balance.toFixed(0)})
                            </span>
                            {sizeResult.systemState === "CAUTION" && <span className="text-[var(--amber)] text-[10px]">{"\u26A0"} CAUTION &mdash; reduced risk</span>}
                          </div>
                        )}
                        {sizeResult?.systemState === "PAUSE" && (
                          <div className="px-3 py-2 border border-[var(--red)]/40 bg-[#1a0000] text-[var(--red)] text-[10px]">
                            SYSTEM PAUSED &mdash; no new entries ({sizeResult.reason})
                          </div>
                        )}
                        {/* Quantity */}
                        <div className="flex items-center gap-3">
                          <span className="text-[var(--dim)] w-24 shrink-0">QUANTITY</span>
                          <input type="number" step="0.0001" value={quantity} onChange={e => setQuantity(e.target.value)}
                            className="w-28 px-2 py-1 bg-[#0a0a0a] border border-[var(--border)] text-white text-right" style={mono} />
                          {(() => {
                            const qty = parseFloat(quantity);
                            const ep = parseFloat(entryPrice);
                            if (qty > 0 && ep > 0 && sizeResult) {
                              const exp = qty * ep;
                              return <span className="text-[var(--dim)] text-[10px]">EXPOSURE: &pound;{exp.toFixed(0)} ({((exp / sizeResult.balance) * 100).toFixed(1)}%)</span>;
                            }
                            return null;
                          })()}
                        </div>
                        {/* Notes */}
                        <div className="flex items-center gap-3">
                          <span className="text-[var(--dim)] w-24 shrink-0">NOTES</span>
                          <input type="text" value={entryNotes} onChange={e => setEntryNotes(e.target.value)} placeholder="Optional"
                            className="flex-1 px-2 py-1 bg-[#0a0a0a] border border-[var(--border)] text-white" style={mono} />
                        </div>
                        {/* Actions */}
                        <div className="flex items-center gap-3 pt-1">
                          <button onClick={() => confirmAdd(s)}
                            disabled={submitting || sizeResult?.systemState === "PAUSE" || !quantity || !entryPrice}
                            className="px-4 py-1.5 border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors text-[10px] font-bold disabled:opacity-30">
                            {submitting ? "ADDING\u2026" : "\u25B6 CONFIRM ADD"}
                          </button>
                          <button onClick={closeEntryPanel} className="px-3 py-1.5 text-[10px] text-[var(--dim)] hover:text-white">
                            {"\u2715"} CANCEL
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* Near misses */}
          <section>
            <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">
              NEAR MISSES &mdash; WATCHING{nearMisses.length > 0 && <span className="text-[var(--dim)] ml-2">{nearMisses.length}</span>}
            </h2>
            <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
              {nearMisses.length === 0 ? (
                <p className="p-4 text-xs text-[var(--dim)]" style={mono}>No near misses</p>
              ) : (
                <table className="w-full text-xs" style={mono}>
                  <thead>
                    <tr className="text-[var(--dim)] border-b border-[var(--border)]">
                      <th className="text-center px-2 py-1">G</th>
                      <th className="text-left px-2 py-1">TICKER</th>
                      <th className="text-left px-2 py-1">SECTOR</th>
                      <th className="text-right px-2 py-1">CHG</th>
                      <th className="text-right px-2 py-1">VOL</th>
                      <th className="text-right px-2 py-1">SCORE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {nearMisses.map(nm => (
                      <tr key={nm.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                        <td className="px-2 py-1 text-center"><GradeBadge grade={nm.grade} size="sm" /></td>
                        <td className="px-2 py-1 font-semibold text-white">{nm.ticker}</td>
                        <td className="px-2 py-1 text-[var(--dim)]">{nm.sector}</td>
                        <td className={`px-2 py-1 text-right ${nm.chg1d >= 0 ? "text-[var(--green)]" : "text-[var(--red)]"}`}>{(nm.chg1d * 100).toFixed(1)}%</td>
                        <td className="px-2 py-1 text-right text-[var(--dim)]">{nm.volRatio.toFixed(1)}&times;</td>
                        <td className="px-2 py-1 text-right text-[var(--dim)]">{nm.compositeScore.toFixed(2)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
