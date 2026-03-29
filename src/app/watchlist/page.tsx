"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { mono, fmtDate } from "../components/helpers";
import { SignalPill } from "../components/SignalPill";
import { AlertPanel } from "../components/AlertPanel";

interface WatchlistItem {
  id: number;
  ticker: string;
  sector: string;
  addedAt: string;
  notes: string | null;
  source: string;
}

export default function WatchlistPage() {
  const [items, setItems] = useState<WatchlistItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [ticker, setTicker] = useState("");
  const [sector, setSector] = useState("");
  const [notes, setNotes] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchItems = useCallback(async () => {
    try {
      const res = await fetch("/api/watchlist");
      if (res.ok) {
        const d = await res.json();
        setItems(d.watchlist ?? []);
      }
    } catch { /* silent */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchItems(); }, [fetchItems]);

  async function addItem() {
    if (!ticker.trim() || !sector.trim()) {
      setError("Ticker and sector are required");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      const res = await fetch("/api/watchlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ticker: ticker.trim().toUpperCase(),
          sector: sector.trim(),
          notes: notes.trim() || undefined,
          source: "manual",
        }),
      });
      if (res.ok) {
        setTicker("");
        setSector("");
        setNotes("");
        fetchItems();
      } else {
        const d = await res.json().catch(() => ({ error: "Failed" }));
        setError(d.error ?? "Failed to add");
      }
    } catch {
      setError("Network error");
    }
    setAdding(false);
  }

  async function removeItem(id: number) {
    await fetch(`/api/watchlist?id=${id}`, { method: "DELETE" });
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  const sourceLabel = (s: string) => {
    if (s === "near-miss") return "momentum";
    if (s === "volume") return "volume";
    if (s === "momentum") return "momentum";
    return "manual";
  };

  return (
    <main className="min-h-screen p-4 max-w-[1400px] mx-auto">
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]" style={mono}>VolumeTurtle</h1>
        <nav className="flex items-center gap-4 text-sm mr-2" style={mono}>
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
          <Link href="/momentum" className="text-[var(--dim)] hover:text-white transition-colors">MOMENTUM</Link>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">WATCHLIST</span>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
        <AlertPanel />
      </header>

      {/* Add form */}
      <section className="mb-6 border border-[var(--border)] bg-[var(--card)] p-4" style={mono}>
        <h2 className="text-xs font-semibold text-[var(--dim)] tracking-widest mb-3">ADD TO WATCHLIST</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-[10px] text-[var(--dim)] mb-1">TICKER</label>
            <input
              type="text"
              value={ticker}
              onChange={(e) => setTicker(e.target.value)}
              placeholder="AAPL"
              className="w-28 px-2 py-1 text-xs bg-[#0a0a0a] border border-[var(--border)] text-white"
              style={mono}
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--dim)] mb-1">SECTOR</label>
            <input
              type="text"
              value={sector}
              onChange={(e) => setSector(e.target.value)}
              placeholder="Technology"
              className="w-32 px-2 py-1 text-xs bg-[#0a0a0a] border border-[var(--border)] text-white"
              style={mono}
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--dim)] mb-1">NOTES</label>
            <input
              type="text"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-48 px-2 py-1 text-xs bg-[#0a0a0a] border border-[var(--border)] text-white"
              style={mono}
            />
          </div>
          <button
            onClick={addItem}
            disabled={adding}
            className="px-3 py-1 text-xs border border-[var(--green)] text-[var(--green)] hover:bg-[var(--green)] hover:text-black transition-colors disabled:opacity-50"
            style={mono}
          >
            {adding ? "ADDING…" : "+ ADD"}
          </button>
        </div>
        {error && <p className="mt-2 text-xs text-[var(--red)]">{error}</p>}
      </section>

      {/* Watchlist table */}
      <section>
        <h2 className="text-sm font-semibold text-[var(--dim)] mb-2 tracking-widest">
          WATCHLIST
          {items.length > 0 && <span className="text-white ml-2">{items.length}</span>}
        </h2>
        <div className="border border-[var(--border)] bg-[var(--card)] overflow-x-auto">
          <table className="w-full text-sm" style={mono}>
            <thead>
              <tr className="text-[var(--dim)] text-xs border-b border-[var(--border)]">
                <th className="text-left px-3 py-2">TICKER</th>
                <th className="text-left px-3 py-2">SECTOR</th>
                <th className="text-center px-3 py-2">SOURCE</th>
                <th className="text-left px-3 py-2">ADDED</th>
                <th className="text-left px-3 py-2">NOTES</th>
                <th className="text-center px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--dim)] text-xs">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-[var(--dim)] text-xs">Watchlist is empty</td></tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-[var(--border)] hover:bg-[#1a1a1a]">
                    <td className="px-3 py-2 font-semibold text-white">{item.ticker}</td>
                    <td className="px-3 py-2 text-[var(--dim)]">{item.sector}</td>
                    <td className="px-3 py-2 text-center">
                      <SignalPill source={sourceLabel(item.source)} />
                    </td>
                    <td className="px-3 py-2 text-[var(--dim)]">{fmtDate(item.addedAt)}</td>
                    <td className="px-3 py-2 text-[var(--dim)]">{item.notes ?? "—"}</td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => removeItem(item.id)}
                        className="px-2 py-0.5 text-xs text-[var(--dim)] hover:text-[var(--red)] transition-colors"
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
