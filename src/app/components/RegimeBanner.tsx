import React from "react";
import type { RegimeData, BreadthData } from "./types";
import { mono } from "./helpers";

export function RegimeBanner({ regime, breadth }: { regime: RegimeData | null; breadth?: BreadthData | null }) {
  if (!regime) return null;

  const isBullish = regime.marketRegime === "BULLISH";
  const isNormalVol = regime.volatilityRegime === "NORMAL";
  const isPanic = regime.volatilityRegime === "PANIC";

  // Breadth layer
  const hasBreadth = breadth != null;
  const breadthGreen = hasBreadth && (breadth.breadthSignal === "STRONG" || breadth.breadthSignal === "NEUTRAL");
  const above50 = breadth?.above50MA ?? 0;

  let overall: string;
  let overallColor: string;
  let bgTint: string;

  if (hasBreadth) {
    // 4-layer assessment
    const layers = [isBullish, isNormalVol, true /* ticker trend assessed per-signal */, breadthGreen];
    const greenCount = layers.filter(Boolean).length;
    if (greenCount >= 4) {
      overall = "FAVOURABLE — all layers green, full execution";
      overallColor = "var(--green)";
      bgTint = "#001a00";
    } else if (greenCount >= 2) {
      overall = "CAUTION — raise standards, reduce size";
      overallColor = "var(--amber)";
      bgTint = "#1a1400";
    } else {
      overall = "HOSTILE — consider pausing new entries";
      overallColor = "var(--red)";
      bgTint = "#1a0000";
    }
    // Breadth override
    if (breadth.breadthSignal === "DETERIORATING" && above50 < 30) {
      overall = "HOSTILE — breadth collapse overrides other layers";
      overallColor = "var(--red)";
      bgTint = "#1a0000";
    }
  } else {
    // Original 2-layer logic
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
  }

  const pctStr = `${regime.qqqPctAboveMA >= 0 ? "+" : ""}${regime.qqqPctAboveMA.toFixed(1)}%`;
  const qqqIcon = isBullish ? "▲" : "▼";
  const qqqColor = isBullish ? "var(--green)" : "var(--red)";
  const volIcon = isNormalVol ? "▲" : isPanic ? "▼" : "—";
  const volColor = isNormalVol ? "var(--green)" : isPanic ? "var(--red)" : "var(--amber)";

  // Breadth display
  let breadthIcon = "";
  let breadthColor = "var(--dim)";
  if (hasBreadth) {
    if (above50 >= 60) { breadthIcon = "▲"; breadthColor = "var(--green)"; }
    else if (above50 >= 45) { breadthIcon = "—"; breadthColor = "var(--amber)"; }
    else if (above50 >= 30) { breadthIcon = "▼"; breadthColor = "var(--amber)"; }
    else { breadthIcon = "▼"; breadthColor = "var(--red)"; }
  }

  return (
    <section className="mb-6 border border-[var(--border)] p-4" style={{ background: bgTint, ...mono }}>
      <p className="text-xs font-semibold text-[var(--dim)] tracking-widest mb-3">
        MARKET REGIME — {regime.asOf}
      </p>

      {/* Compact layer row */}
      <div className="flex flex-wrap items-center gap-3 text-sm mb-3">
        <span>
          <span className="text-[var(--dim)]">QQQ </span>
          <span style={{ color: qqqColor }}>{qqqIcon}</span>
        </span>
        <span className="text-[var(--border)]">·</span>
        <span>
          <span className="text-[var(--dim)]">VIX </span>
          <span className="text-white">{regime.vixLevel?.toFixed(1) ?? "—"} </span>
          <span style={{ color: volColor }}>{volIcon}</span>
        </span>
        {hasBreadth && (
          <>
            <span className="text-[var(--border)]">·</span>
            <span>
              <span className="text-[var(--dim)]">BREADTH </span>
              <span className="text-white">{above50.toFixed(0)}% </span>
              <span style={{ color: breadthColor }}>{breadthIcon}</span>
              {above50 < 30 && (
                <span className="ml-1 text-[var(--red)] text-xs font-bold">WEAK</span>
              )}
            </span>
          </>
        )}
      </div>

      {/* Detail grid */}
      <div className="grid grid-cols-[auto_1fr_auto] gap-x-4 gap-y-1 text-sm mb-3">
        <span className="text-[var(--dim)]">QQQ</span>
        <span className="text-white">${regime.qqqClose.toFixed(2)}</span>
        <span className={isBullish ? "text-[var(--green)]" : "text-[var(--red)]"}>
          {isBullish ? "▲" : "▼"} {pctStr} {isBullish ? "above" : "below"} 200MA
        </span>

        <span className="text-[var(--dim)]">VIX</span>
        <span className="text-white">{regime.vixLevel?.toFixed(1) ?? "—"}</span>
        <span style={{ color: volColor }}>{regime.volatilityRegime}</span>
      </div>

      {/* Breadth warning */}
      {breadth?.warning && (
        <div
          className="text-xs px-2 py-1.5 mb-2 border-l-2"
          style={{
            color: above50 < 30 ? "var(--red)" : "var(--amber)",
            borderColor: above50 < 30 ? "var(--red)" : "var(--amber)",
            background: above50 < 30 ? "rgba(255,50,50,0.06)" : "rgba(255,180,0,0.06)",
          }}
        >
          ⚠ {breadth.warning}
        </div>
      )}

      <div className="border-t border-[var(--border)] pt-2 text-sm">
        <span className="text-[var(--dim)]">Overall: </span>
        <span style={{ color: overallColor }}>{overall}</span>
      </div>
    </section>
  );
}
