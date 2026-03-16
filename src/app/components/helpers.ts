export const mono = { fontFamily: "'JetBrains Mono', 'Fira Code', monospace" };

export function fmtDate(d: string | null): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" });
}

export function fmtMoney(n: number): string {
  return "£" + n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

export function fmtPrice(n: number, currency = "£"): string {
  return currency + n.toFixed(2);
}

/** Currency symbol for a ticker based on exchange suffix */
export function tickerCurrency(ticker: string): string {
  if (ticker.endsWith(".L")) return "£";
  if (ticker.endsWith(".AS") || ticker.endsWith(".HE")) return "€";
  if (ticker.endsWith(".ST") || ticker.endsWith(".CO")) return "kr";
  return "$";
}

export function fmtTime(iso: string | null): string {
  if (!iso) return "Never";
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }) + " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

export function pctChange(from: number, to: number): string {
  if (from === 0) return "0.0%";
  return ((to - from) / from * 100).toFixed(1) + "%";
}
