"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { JournalData, SignalSourceFilter } from "./types";
import { JournalFilterBar } from "./components/JournalFilterBar";
import { PeriodSummaryCard } from "./components/PeriodSummaryCard";
import { BalanceChart } from "./components/BalanceChart";
import { RRChart } from "./components/RRChart";
import { MonthlyStatsTable } from "./components/MonthlyStatsTable";
import { AccountSidebar } from "./components/AccountSidebar";

const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-[var(--card)] border border-[var(--border)] rounded-xl animate-pulse ${className}`}
    />
  );
}

export default function JournalPage() {
  const [data, setData] = useState<JournalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<SignalSourceFilter>("all");

  const fetchData = useCallback(async (src: SignalSourceFilter) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/journal?source=${src}`);
      if (!res.ok) throw new Error("Failed to fetch journal data");
      const json: JournalData = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(source);
  }, [source, fetchData]);

  const handleSourceChange = (v: SignalSourceFilter) => {
    setSource(v);
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] p-4 md:p-6 lg:p-8">
      {/* ── HEADER ── */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1
          className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]"
          style={mono}
        >
          VolumeTurtle
        </h1>
        <nav className="flex items-center gap-4 text-sm mr-2" style={mono}>
          <Link
            href="/"
            className="text-[var(--dim)] hover:text-white transition-colors"
          >
            DASHBOARD
          </Link>
          <span className="text-white font-semibold border-b-2 border-[var(--green)] pb-0.5">
            JOURNAL
          </span>
          <Link
            href="/momentum"
            className="text-[var(--dim)] hover:text-white transition-colors"
          >
            MOMENTUM
          </Link>
          <Link
            href="/watchlist"
            className="text-[var(--dim)] hover:text-white transition-colors"
          >
            WATCHLIST
          </Link>
          <Link
            href="/settings"
            className="text-[var(--dim)] hover:text-white transition-colors"
          >
            SETTINGS
          </Link>
        </nav>
      </header>

      {/* ── FILTER BAR ── */}
      <div className="mb-6">
        <JournalFilterBar active={source} onChange={handleSourceChange} />
      </div>

      {/* ── ERROR ── */}
      {error && (
        <div className="bg-[var(--red)]/10 border border-[var(--red)]/30 rounded-lg p-4 mb-6 text-sm text-[var(--red)]">
          {error}
        </div>
      )}

      {/* ── MAIN LAYOUT ── */}
      <div className="flex flex-col lg:flex-row gap-6">
        {/* Left: main content */}
        <div className="flex-1 min-w-0 flex flex-col gap-6">
          {/* Period summary cards */}
          {loading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, i) => (
                <SkeletonBlock key={i} className="h-[180px]" />
              ))}
            </div>
          ) : data ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              <PeriodSummaryCard title="This Week" stats={data.periodStats.week} />
              <PeriodSummaryCard title="This Month" stats={data.periodStats.month} />
              <PeriodSummaryCard title="This Year" stats={data.periodStats.year} />
              <PeriodSummaryCard title="All Time" stats={data.periodStats.allTime} />
            </div>
          ) : null}

          {/* Charts row */}
          {loading ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <SkeletonBlock className="h-[320px]" />
              <SkeletonBlock className="h-[320px]" />
            </div>
          ) : data ? (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <BalanceChart data={data.balanceHistory} />
              <RRChart trades={data.closedTrades} />
            </div>
          ) : null}

          {/* Monthly stats table */}
          {loading ? (
            <SkeletonBlock className="h-[200px]" />
          ) : data ? (
            <MonthlyStatsTable stats={data.monthlyStats} />
          ) : null}
        </div>

        {/* Right: account sidebar */}
        <div className="w-full lg:w-[360px] shrink-0">
          {loading ? (
            <SkeletonBlock className="h-[600px]" />
          ) : data ? (
            <AccountSidebar
              account={data.accountMetrics}
              openTrades={data.openTrades}
              closedTrades={data.closedTrades}
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
