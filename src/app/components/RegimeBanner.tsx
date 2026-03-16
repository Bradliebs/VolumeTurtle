import React from "react";
import type { RegimeData } from "./types";
import { mono } from "./helpers";

export function RegimeBanner({ regime }: { regime: RegimeData | null }) {
  if (!regime) return null;

  const isBullish = regime.marketRegime === "BULLISH";
  const isNormalVol = regime.volatilityRegime === "NORMAL";
  const isPanic = regime.volatilityRegime === "PANIC";

  let overall: string;
  let overallColor: string;
  let bgTint: string;
  if (isBullish && isNormalVol) {
    overall = "FAVOURABLE — conditions support new entries";
    overallColor = "var(--green)";
    bgTint = "#001a00";
  } else if (isPanic || (!isBullish && !isNormalVol)) {
    overall = "HOSTILE — consider pausing new entries";
    overallColor = "var(--red)";
    bgTint = "#1a0000";
  } else {
    overall = "CAUTION — raise standards, reduce size";
    overallColor = "var(--amber)";
    bgTint = "#1a1400";
  }

  const pctStr = `${regime.qqqPctAboveMA >= 0 ? "+" : ""}${regime.qqqPctAboveMA.toFixed(1)}%`;
  const qqqIcon = isBullish ? "✓" : "✗";
  const qqqColor = isBullish ? "var(--green)" : "var(--red)";
  const volIcon = isNormalVol ? "✓" : isPanic ? "✗" : "⚠";
  const volColor = isNormalVol ? "var(--green)" : isPanic ? "var(--red)" : "var(--amber)";

  return (
    <section className="mb-6 border border-[var(--border)] p-4" style={{ background: bgTint, ...mono }}>
      <p className="text-xs font-semibold text-[var(--dim)] tracking-widest mb-3">
        MARKET REGIME — {regime.asOf}
      </p>
      <div className="grid grid-cols-[auto_1fr_auto_auto] gap-x-4 gap-y-1 text-sm mb-3">
        <span className="text-[var(--dim)]">QQQ</span>
        <span className="text-white">${regime.qqqClose.toFixed(2)}</span>
        <span className={isBullish ? "text-[var(--green)]" : "text-[var(--red)]"}>
          {isBullish ? "▲" : "▼"} {pctStr} {isBullish ? "above" : "below"} 200MA
        </span>
        <span style={{ color: qqqColor }}>{qqqIcon} {regime.marketRegime}</span>

        <span className="text-[var(--dim)]">VIX</span>
        <span className="text-white">{regime.vixLevel?.toFixed(1) ?? "—"}</span>
        <span />
        <span style={{ color: volColor }}>{volIcon} {regime.volatilityRegime}</span>
      </div>
      <div className="border-t border-[var(--border)] pt-2 text-sm">
        <span className="text-[var(--dim)]">Overall regime: </span>
        <span style={{ color: overallColor }}>{isBullish && isNormalVol ? "✅" : isPanic || (!isBullish && !isNormalVol) ? "🔴" : "⚠"} {overall}</span>
      </div>
    </section>
  );
}
