import React from "react";
import { fmtMoney, mono } from "./helpers";

export function ConfirmModal({
  balance,
  remaining,
  onConfirm,
  onCancel,
}: {
  balance: number;
  remaining: number;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70" role="dialog" aria-modal="true" aria-labelledby="confirm-modal-title">
      <div className="border border-[#333] bg-[#111] p-6 w-full max-w-md">
        <h3 id="confirm-modal-title" className="text-lg font-semibold text-[var(--amber)] mb-4">⚠ LIVE SCAN</h3>
        <p className="text-sm text-[var(--dim)] mb-1">This will write trades to the database.</p>
        <p className="text-sm text-[var(--dim)] mb-1">
          Current balance: <span className="text-white" style={mono}>{fmtMoney(balance)}</span>
        </p>
        <p className="text-sm text-[var(--dim)] mb-6">
          Max new positions: <span className="text-white" style={mono}>{remaining}</span> remaining
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm border border-[#333] text-[var(--dim)] hover:text-white transition-colors"
          >
            CANCEL
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm border border-[var(--red)] text-[var(--red)] hover:bg-[var(--red)] hover:text-black transition-colors font-semibold"
          >
            CONFIRM — RUN LIVE SCAN
          </button>
        </div>
      </div>
    </div>
  );
}
