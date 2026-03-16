"use client";

import React, { useState } from "react";
import type { ScanHistoryEntry } from "./types";
import { mono } from "./helpers";
import { SkeletonRows } from "./SkeletonRows";
import { Badge } from "./Badge";

export function ScanHistorySection({ entries, loading }: { entries: ScanHistoryEntry[]; loading: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <section className="mb-6">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest hover:text-white transition-colors"
      >
        <span>{expanded ? "▼" : "▶"}</span>
        SCAN HISTORY
        {entries.length > 0 && (
          <span className="text-xs font-normal text-[#555]">({entries.length} recent)</span>
        )}
      </button>
      {expanded && (
        <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          <table className="w-full text-sm" style={mono}>
            <thead>
              <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                <th className="text-left px-3 py-2">DATE</th>
                <th className="text-left px-3 py-2">TIME</th>
                <th className="text-left px-3 py-2">MARKET</th>
                <th className="text-center px-3 py-2">REGIME</th>
                <th className="text-right px-3 py-2">SIGNALS</th>
                <th className="text-right px-3 py-2">TICKERS</th>
                <th className="text-center px-3 py-2">TRIGGER</th>
                <th className="text-right px-3 py-2">DURATION</th>
                <th className="text-center px-3 py-2">STATUS</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <SkeletonRows cols={9} />
              ) : entries.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-[var(--dim)] text-xs">
                    No scan history yet
                  </td>
                </tr>
              ) : (
                entries.map((s) => {
                  const d = new Date(s.startedAt);
                  const dateStr = d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                  const timeStr = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
                  const durationStr = s.durationMs != null ? (s.durationMs < 1000 ? `${s.durationMs}ms` : `${(s.durationMs / 1000).toFixed(0)}s`) : "—";
                  const triggerColor = s.trigger === "SCHEDULED" ? "var(--green)" : "var(--dim)";
                  const statusColor = s.status === "COMPLETED" ? "var(--green)" : s.status === "FAILED" ? "var(--red)" : "var(--amber)";

                  return (
                    <tr key={s.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                      <td className="px-3 py-2 text-[var(--dim)]">{dateStr}</td>
                      <td className="px-3 py-2 text-[var(--dim)]">{timeStr}</td>
                      <td className="px-3 py-2">{s.market}</td>
                      <td className="px-3 py-2 text-center">
                        {s.marketRegime ? (
                          <span style={{ color: s.marketRegime === "BULLISH" ? "var(--green)" : "var(--red)" }}>
                            {s.marketRegime === "BULLISH" ? "✅" : "🔴"} {s.marketRegime.slice(0, 4)}
                          </span>
                        ) : (
                          <span className="text-[var(--dim)]">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={s.signalsFound > 0 ? "text-[var(--green)]" : "text-[var(--dim)]"}>
                          {s.signalsFound}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--dim)]">{s.tickersScanned}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge label={s.trigger} color={triggerColor} />
                      </td>
                      <td className="px-3 py-2 text-right text-[var(--dim)]">{durationStr}</td>
                      <td className="px-3 py-2 text-center">
                        <Badge label={s.status} color={statusColor} />
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
