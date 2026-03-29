"use client";
import React, { useState, useEffect, useCallback } from "react";
import { mono } from "./helpers";

interface AlertData {
  id: number;
  type: string;
  ticker: string;
  message: string;
  severity: string;
  createdAt: string;
}

export function AlertPanel() {
  const [open, setOpen] = useState(false);
  const [alerts, setAlerts] = useState<AlertData[]>([]);
  const [criticalCount, setCriticalCount] = useState(0);

  const fetchAlerts = useCallback(async () => {
    try {
      const res = await fetch("/api/alerts");
      if (res.ok) {
        const data = await res.json();
        setAlerts(data.alerts ?? []);
        setCriticalCount(data.criticalCount ?? 0);
      }
    } catch { /* silent */ }
  }, []);

  useEffect(() => {
    fetchAlerts();
    const interval = setInterval(fetchAlerts, 60_000);
    return () => clearInterval(interval);
  }, [fetchAlerts]);

  async function acknowledge(id: number) {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setAlerts((prev) => prev.filter((a) => a.id !== id));
    setCriticalCount((prev) => Math.max(0, prev - 1));
  }

  async function acknowledgeAll() {
    await fetch("/api/alerts", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    });
    setAlerts([]);
    setCriticalCount(0);
  }

  const total = alerts.length;

  return (
    <div className="relative" style={mono}>
      <button
        onClick={() => setOpen(!open)}
        className="relative px-2 py-1 text-xs text-[var(--dim)] hover:text-white transition-colors"
      >
        🔔
        {total > 0 && (
          <span
            className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center text-[8px] font-bold rounded-full"
            style={{
              backgroundColor: criticalCount > 0 ? "var(--red)" : "var(--amber)",
              color: "#000",
            }}
          >
            {total > 9 ? "9+" : total}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-50 w-80 max-h-96 overflow-y-auto border border-[var(--border)] bg-[#111] shadow-lg">
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <span className="text-xs font-semibold text-[var(--dim)] tracking-widest">ALERTS</span>
            {total > 0 && (
              <button onClick={acknowledgeAll} className="text-[9px] text-[var(--dim)] hover:text-white">
                CLEAR ALL
              </button>
            )}
          </div>
          {total === 0 ? (
            <p className="px-3 py-4 text-xs text-[var(--dim)] text-center">No unacknowledged alerts</p>
          ) : (
            alerts.map((a) => (
              <div
                key={a.id}
                className="px-3 py-2 border-b border-[var(--border)] hover:bg-[#1a1a1a] text-xs"
              >
                <div className="flex items-start gap-2">
                  <span className={
                    a.severity === "critical" ? "text-[var(--red)]"
                      : a.severity === "warning" ? "text-[var(--amber)]"
                        : "text-[var(--dim)]"
                  }>
                    {a.severity === "critical" ? "🔴" : a.severity === "warning" ? "🟡" : "ℹ️"}
                  </span>
                  <div className="flex-1 min-w-0">
                    <span className="font-semibold text-white">{a.ticker}</span>
                    <span className="text-[var(--dim)] ml-1">{a.type}</span>
                    <p className="text-[var(--dim)] text-[10px] mt-0.5 break-words">{a.message}</p>
                  </div>
                  <button
                    onClick={() => acknowledge(a.id)}
                    className="text-[var(--dim)] hover:text-white shrink-0"
                  >
                    ✕
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
