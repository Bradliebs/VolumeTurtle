"use client";

import React, { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { mono, fmtMoney, fmtPrice, tickerCurrency } from "../components/helpers";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PendingOrderRow {
  id: number;
  ticker: string;
  sector: string;
  signalSource: string;
  signalGrade: string;
  compositeScore: number;
  suggestedShares: number;
  suggestedEntry: number;
  suggestedStop: number;
  dollarRisk: number;
  status: string;
  cancelDeadline: string;
  cancelledAt: string | null;
  cancelReason: string | null;
  executedAt: string | null;
  t212OrderId: string | null;
  actualShares: number | null;
  actualPrice: number | null;
  failureReason: string | null;
  isRunner: boolean;
  createdAt: string;
  secondsRemaining: number;
  canCancel: boolean;
  canExecuteNow: boolean;
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function PendingOrdersPage() {
  const [orders, setOrders] = useState<PendingOrderRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<number | null>(null);
  const [executingId, setExecutingId] = useState<number | null>(null);
  const [confirmExecuteId, setConfirmExecuteId] = useState<number | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchOrders = useCallback(async () => {
    try {
      const res = await fetch("/api/execution/pending");
      if (!res.ok) throw new Error("Failed to fetch");
      const data = await res.json();
      setOrders(data.orders ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOrders();
    const interval = setInterval(fetchOrders, 10_000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [fetchOrders]);

  // Countdown timer — decrement every second for pending orders
  useEffect(() => {
    const interval = setInterval(() => {
      setOrders((prev) =>
        prev.map((o) =>
          o.status === "pending" && o.secondsRemaining > 0
            ? { ...o, secondsRemaining: o.secondsRemaining - 1 }
            : o,
        ),
      );
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  async function cancelOrder(orderId: number) {
    setCancellingId(orderId);
    try {
      const res = await fetch("/api/execution/pending", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Cancel failed");
      }
      await fetchOrders();
    } catch {
      setError("Network error");
    } finally {
      setCancellingId(null);
    }
  }

  async function executeNow(orderId: number) {
    setExecutingId(orderId);
    setConfirmExecuteId(null);
    try {
      const res = await fetch("/api/execution/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ orderId }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Execution failed");
      }
      await fetchOrders();
    } catch {
      setError("Network error");
    } finally {
      setExecutingId(null);
    }
  }

  async function emergencyDisableAll() {
    try {
      const res = await fetch("/api/execution/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "emergency_disable" }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? "Emergency disable failed");
      }
      await fetchOrders();
    } catch {
      setError("Network error");
    }
  }

  const filtered = statusFilter === "all"
    ? orders
    : orders.filter((o) => o.status === statusFilter);

  const pendingCount = orders.filter((o) => o.status === "pending").length;

  return (
    <div className="min-h-screen p-6 max-w-[1200px] mx-auto" style={mono}>
      {/* ── Error banner ── */}
      {error && (
        <div className="mb-4 p-3 bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] text-sm">
          {error}
          <button className="ml-4 text-xs underline" onClick={() => setError(null)}>dismiss</button>
        </div>
      )}

      {/* ── HEADER ── */}
      <header className="flex flex-wrap items-center gap-4 border-b border-[var(--border)] pb-3 mb-6">
        <h1 className="text-xl font-bold tracking-tight mr-2 text-[var(--green)]">
          VolumeTurtle
        </h1>
        <nav className="flex items-center gap-4 text-sm mr-2">
          <Link href="/" className="text-[var(--dim)] hover:text-white transition-colors">DASHBOARD</Link>
          <Link href="/journal" className="text-[var(--dim)] hover:text-white transition-colors">JOURNAL</Link>
          <Link href="/momentum" className="text-[var(--dim)] hover:text-white transition-colors">MOMENTUM</Link>
          <Link href="/watchlist" className="text-[var(--dim)] hover:text-white transition-colors">WATCHLIST</Link>
          <span className="text-white font-semibold border-b-2 border-[var(--amber)] pb-0.5">
            PENDING {pendingCount > 0 && <span className="text-[var(--amber)]">({pendingCount})</span>}
          </span>
          <Link href="/settings" className="text-[var(--dim)] hover:text-white transition-colors">SETTINGS</Link>
        </nav>
      </header>

      <div className="flex items-center justify-between mb-6">
        <h2 className="text-lg font-semibold text-white">PENDING ORDERS</h2>
        <div className="flex items-center gap-3">
          {/* Status filter */}
          <select
            className="bg-[var(--card)] border border-[var(--border)] text-sm px-2 py-1 text-white"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <option value="all">All orders</option>
            <option value="pending">Pending</option>
            <option value="executed">Executed</option>
            <option value="cancelled">Cancelled</option>
            <option value="failed">Failed</option>
            <option value="expired">Expired</option>
          </select>

          {/* Emergency disable */}
          {pendingCount > 0 && (
            <button
              onClick={emergencyDisableAll}
              className="px-3 py-1.5 text-xs font-semibold bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] hover:bg-[var(--red)]/30 transition-colors"
            >
              ⛔ EMERGENCY STOP
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-[var(--dim)] text-sm">Loading orders…</div>
      )}

      {!loading && filtered.length === 0 && (
        <div className="text-center py-12 text-[var(--dim)]">
          <p className="text-lg mb-2">No {statusFilter === "all" ? "" : statusFilter} orders</p>
          <p className="text-sm">Orders are created automatically when A/B signals fire during scans.</p>
        </div>
      )}

      <div className="space-y-4">
        {filtered.map((order) => (
          <OrderCard
            key={order.id}
            order={order}
            cancellingId={cancellingId}
            executingId={executingId}
            confirmExecuteId={confirmExecuteId}
            onCancel={cancelOrder}
            onExecuteNow={(id) => setConfirmExecuteId(id)}
            onConfirmExecute={executeNow}
            onCancelConfirm={() => setConfirmExecuteId(null)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Order Card
// ---------------------------------------------------------------------------

function OrderCard({
  order,
  cancellingId,
  executingId,
  confirmExecuteId,
  onCancel,
  onExecuteNow,
  onConfirmExecute,
  onCancelConfirm,
}: {
  order: PendingOrderRow;
  cancellingId: number | null;
  executingId: number | null;
  confirmExecuteId: number | null;
  onCancel: (id: number) => void;
  onExecuteNow: (id: number) => void;
  onConfirmExecute: (id: number) => void;
  onCancelConfirm: () => void;
}) {
  const currency = tickerCurrency(order.ticker);
  const isPending = order.status === "pending";
  const isSubmitting = order.secondsRemaining <= 0 && isPending;

  const gradeColor = order.signalGrade === "A" ? "var(--green)" : "var(--amber)";
  const sourceLabel = order.signalSource === "volume" ? "VOL" : "MOM";

  const statusColor: Record<string, string> = {
    pending: "var(--amber)",
    executed: "var(--green)",
    cancelled: "var(--dim)",
    failed: "var(--red)",
    expired: "var(--dim)",
  };

  return (
    <div
      className="bg-[var(--card)] border border-[var(--border)] p-4"
      style={{
        borderLeftWidth: "3px",
        borderLeftColor: statusColor[order.status] ?? "var(--border)",
      }}
    >
      <div className="flex items-start justify-between gap-4">
        {/* Left: ticker + details */}
        <div className="flex-1">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg font-bold text-white">{order.ticker}</span>
            <span
              className="px-2 py-0.5 text-xs font-bold"
              style={{ background: gradeColor + "22", color: gradeColor, border: `1px solid ${gradeColor}44` }}
            >
              {order.signalGrade}
            </span>
            <span className="px-2 py-0.5 text-xs font-semibold bg-white/5 border border-[var(--border)] text-[var(--dim)]">
              {sourceLabel}
            </span>
            {order.isRunner && (
              <span className="px-2 py-0.5 text-xs font-semibold bg-[var(--green)]/10 border border-[var(--green)]/30 text-[var(--green)]">
                🏃 RUNNER
              </span>
            )}
            <span className="text-xs text-[var(--dim)]">{order.sector}</span>
          </div>

          <div className="grid grid-cols-4 gap-4 text-sm">
            <div>
              <span className="text-[var(--dim)] text-xs">SHARES</span>
              <div className="font-semibold text-white">{order.suggestedShares}</div>
            </div>
            <div>
              <span className="text-[var(--dim)] text-xs">PRICE</span>
              <div className="font-semibold text-white">{fmtPrice(order.suggestedEntry, currency)}</div>
            </div>
            <div>
              <span className="text-[var(--dim)] text-xs">STOP</span>
              <div className="font-semibold text-[var(--red)]">{fmtPrice(order.suggestedStop, currency)}</div>
            </div>
            <div>
              <span className="text-[var(--dim)] text-xs">RISK</span>
              <div className="font-semibold text-white">{fmtMoney(order.dollarRisk)}</div>
            </div>
          </div>

          <div className="text-xs text-[var(--dim)] mt-2">
            Score: {order.compositeScore.toFixed(2)}
            {order.actualPrice != null && (
              <span className="ml-4 text-[var(--green)]">
                Filled: {order.actualShares} @ {fmtPrice(order.actualPrice, currency)}
              </span>
            )}
            {order.failureReason && (
              <span className="ml-4 text-[var(--red)]">
                {order.failureReason}
              </span>
            )}
            {order.cancelReason && (
              <span className="ml-4 text-[var(--dim)]">
                Reason: {order.cancelReason}
              </span>
            )}
          </div>
        </div>

        {/* Right: countdown + actions */}
        <div className="flex flex-col items-end gap-2 min-w-[160px]">
          {isPending && (
            <>
              {/* Countdown timer */}
              <div className="text-right">
                {isSubmitting ? (
                  <div className="text-lg font-bold text-[var(--amber)] animate-pulse">
                    SUBMITTING…
                  </div>
                ) : (
                  <>
                    <div className="text-2xl font-bold text-[var(--amber)] tabular-nums">
                      {formatCountdown(order.secondsRemaining)}
                    </div>
                    <div className="text-xs text-[var(--dim)]">until execution</div>
                  </>
                )}
              </div>

              {/* Action buttons */}
              <div className="flex gap-2">
                {order.canCancel && (
                  <button
                    onClick={() => onCancel(order.id)}
                    disabled={cancellingId === order.id}
                    className="px-3 py-1.5 text-xs font-semibold bg-[var(--red)]/20 border border-[var(--red)]/40 text-[var(--red)] hover:bg-[var(--red)]/30 transition-colors disabled:opacity-50"
                  >
                    {cancellingId === order.id ? "…" : "✕ CANCEL"}
                  </button>
                )}

                {confirmExecuteId === order.id ? (
                  <div className="flex gap-1">
                    <button
                      onClick={() => onConfirmExecute(order.id)}
                      disabled={executingId === order.id}
                      className="px-3 py-1.5 text-xs font-bold bg-[var(--green)]/20 border border-[var(--green)]/40 text-[var(--green)] hover:bg-[var(--green)]/30 transition-colors disabled:opacity-50"
                    >
                      {executingId === order.id ? "…" : "CONFIRM"}
                    </button>
                    <button
                      onClick={onCancelConfirm}
                      className="px-2 py-1.5 text-xs text-[var(--dim)] hover:text-white"
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => onExecuteNow(order.id)}
                    disabled={executingId === order.id}
                    className="px-3 py-1.5 text-xs font-semibold bg-cyan-500/20 border border-cyan-500/40 text-cyan-400 hover:bg-cyan-500/30 transition-colors disabled:opacity-50"
                  >
                    ▶ EXECUTE NOW
                  </button>
                )}
              </div>
            </>
          )}

          {!isPending && (
            <div className="text-right">
              <span
                className="px-2 py-1 text-xs font-bold uppercase"
                style={{ color: statusColor[order.status] ?? "var(--dim)" }}
              >
                {order.status}
              </span>
              <div className="text-xs text-[var(--dim)] mt-1">
                {order.executedAt
                  ? new Date(order.executedAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                  : order.cancelledAt
                    ? new Date(order.cancelledAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })
                    : new Date(order.createdAt).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}`;
}
