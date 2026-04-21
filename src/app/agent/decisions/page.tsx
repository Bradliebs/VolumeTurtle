"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

interface Decision {
  id: number;
  cycleId: string;
  cycleStartedAt: string;
  createdAt: string;
  durationMs: number;
  toolCount: number;
  toolNames: string[];
  hasExecution: boolean;
  telegramSent: boolean;
  errorMessage: string | null;
  reasoning: string;
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export default function AgentDecisionsPage() {
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executionsOnly, setExecutionsOnly] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  const fetchDecisions = useCallback(async (only: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/decisions?executionsOnly=${only ? "1" : "0"}`);
      if (!res.ok) {
        throw new Error(`Failed to load decisions (${res.status})`);
      }
      const json = (await res.json()) as { decisions: Decision[] };
      setDecisions(json.decisions ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setDecisions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchDecisions(executionsOnly);
  }, [executionsOnly, fetchDecisions]);

  function toggleExpand(id: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 md:p-6 lg:p-8">
      {/* ── HEADER ── */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]" style={mono}>
          VolumeTurtle
        </h1>
        <nav className="flex items-center gap-4 text-sm mr-2" style={mono}>
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
          <Link href="/journal" className="text-[var(--dim)] hover:text-white transition-colors">JOURNAL</Link>
          <Link href="/momentum" className="text-[var(--dim)] hover:text-white transition-colors">MOMENTUM</Link>
          <Link href="/watchlist" className="text-[var(--dim)] hover:text-white transition-colors">WATCHLIST</Link>
          <Link href="/execution" className="text-[var(--amber)] hover:text-white transition-colors">PENDING</Link>
          <Link href="/backtest" className="text-[var(--dim)] hover:text-white transition-colors">BACKTEST</Link>
          <span className="text-white font-semibold border-b-2 border-[#a78bfa] pb-0.5">AGENT</span>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
        <span className="text-[var(--border)]">|</span>
        <span className="text-sm text-[var(--dim)]" style={mono}>
          Last 50 cycles · {decisions.length} shown
        </span>
      </header>

      {/* ── FILTER ── */}
      <div className="mb-4 flex items-center gap-4 text-xs" style={mono}>
        <span className="text-[var(--dim)]">Filter:</span>
        <button
          onClick={() => setExecutionsOnly(!executionsOnly)}
          title="Toggle executions-only filter"
          className={`w-10 h-5 rounded-full transition-colors relative ${executionsOnly ? "bg-[#a78bfa]" : "bg-[#333]"}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${executionsOnly ? "left-5" : "left-0.5"}`} />
        </button>
        <span className={executionsOnly ? "text-[#a78bfa]" : "text-[var(--dim)]"}>
          Show executions only
        </span>
      </div>

      {/* ── ERROR ── */}
      {error && (
        <div className="bg-[var(--red)]/10 border border-[var(--red)]/30 rounded p-4 mb-6 text-sm text-[var(--red)]">
          {error}
          <button
            onClick={() => void fetchDecisions(executionsOnly)}
            className="ml-4 text-xs underline hover:text-white"
          >
            Retry
          </button>
        </div>
      )}

      {/* ── LOADING ── */}
      {loading && (
        <div className="text-xs text-[var(--dim)]" style={mono}>Loading…</div>
      )}

      {/* ── EMPTY ── */}
      {!loading && !error && decisions.length === 0 && (
        <div className="border border-[var(--border)] bg-[var(--card)] p-8 text-center text-sm text-[var(--dim)]" style={mono}>
          No agent cycles {executionsOnly ? "with executions " : ""}recorded yet.
        </div>
      )}

      {/* ── DECISIONS LIST ── */}
      {!loading && decisions.length > 0 && (
        <div className="space-y-2">
          {decisions.map((d) => {
            const isOpen = expanded.has(d.id);
            const hasError = Boolean(d.errorMessage);
            const accent = hasError
              ? "border-[var(--red)]/50"
              : d.hasExecution
                ? "border-[#a78bfa]/50"
                : "border-[var(--border)]";
            return (
              <div
                key={d.id}
                className={`border ${accent} bg-[var(--card)]`}
                style={mono}
              >
                {/* Row header — clickable */}
                <button
                  onClick={() => toggleExpand(d.id)}
                  className="w-full flex flex-wrap items-center gap-3 px-3 py-2 text-xs hover:bg-[var(--border)]/20 transition-colors text-left"
                >
                  <span className="text-[var(--dim)] w-4">{isOpen ? "▾" : "▸"}</span>
                  <span className="text-white w-44">{fmtTime(d.createdAt)}</span>
                  <span className="text-[var(--dim)] w-16">{(d.durationMs / 1000).toFixed(1)}s</span>
                  <span className="text-[var(--dim)] w-20">{d.toolCount} tools</span>
                  <span className={`w-24 ${d.telegramSent ? "text-[var(--green)]" : "text-[var(--dim)]"}`}>
                    Telegram: {d.telegramSent ? "✓" : "✗"}
                  </span>
                  {d.hasExecution && (
                    <span className="text-[#a78bfa] font-semibold">⚡ EXECUTED</span>
                  )}
                  {hasError && (
                    <span className="text-[var(--red)] font-semibold">✗ ERROR</span>
                  )}
                  <span className="text-[#555] text-[10px] ml-auto">{d.cycleId.slice(0, 8)}</span>
                </button>

                {/* Expanded body */}
                {isOpen && (
                  <div className="border-t border-[var(--border)] px-3 py-3 text-xs space-y-3">
                    {d.toolNames.length > 0 && (
                      <div>
                        <div className="text-[var(--dim)] text-[10px] uppercase tracking-wider mb-1">Tools called</div>
                        <div className="flex flex-wrap gap-2">
                          {d.toolNames.map((name, i) => (
                            <span
                              key={`${d.id}-tool-${i}`}
                              className="px-2 py-0.5 border border-[var(--border)] text-[var(--dim)]"
                            >
                              {name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {hasError && (
                      <div>
                        <div className="text-[var(--red)] text-[10px] uppercase tracking-wider mb-1">Error</div>
                        <pre className="whitespace-pre-wrap text-[var(--red)] bg-[#1a0000] border border-[var(--red)]/30 p-2">
                          {d.errorMessage}
                        </pre>
                      </div>
                    )}

                    <div>
                      <div className="text-[var(--dim)] text-[10px] uppercase tracking-wider mb-1">Reasoning</div>
                      {d.reasoning.trim().length === 0 ? (
                        <div className="text-[#555] italic">(no reasoning recorded)</div>
                      ) : (
                        <pre className="whitespace-pre-wrap text-[var(--foreground)] bg-[#0a0a0a] border border-[var(--border)] p-2 max-h-96 overflow-auto">
                          {d.reasoning}
                        </pre>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
