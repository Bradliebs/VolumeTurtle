/**
 * Cruise Control — Market Hours
 *
 * Pure logic for determining if markets are open.
 * No side effects, no DB, no imports beyond types.
 */

// UK bank holidays 2025-2035 (dates in YYYY-MM-DD)
export const UK_BANK_HOLIDAYS: Set<string> = new Set([
  // 2025
  "2025-01-01", "2025-04-18", "2025-04-21", "2025-05-05",
  "2025-05-26", "2025-08-25", "2025-12-25", "2025-12-26",
  // 2026
  "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-04",
  "2026-05-25", "2026-08-31", "2026-12-25", "2026-12-28",
  // 2027
  "2027-01-01", "2027-03-26", "2027-03-29", "2027-05-03",
  "2027-05-31", "2027-08-30", "2027-12-27", "2027-12-28",
  // 2028
  "2028-01-03", "2028-04-14", "2028-04-17", "2028-05-01",
  "2028-05-29", "2028-08-28", "2028-12-25", "2028-12-26",
  // 2029
  "2029-01-01", "2029-03-30", "2029-04-02", "2029-05-07",
  "2029-05-28", "2029-08-27", "2029-12-25", "2029-12-26",
  // 2030
  "2030-01-01", "2030-04-19", "2030-04-22", "2030-05-06",
  "2030-05-27", "2030-08-26", "2030-12-25", "2030-12-26",
  // 2031
  "2031-01-01", "2031-04-11", "2031-04-14", "2031-05-05",
  "2031-05-26", "2031-08-25", "2031-12-25", "2031-12-26",
  // 2032
  "2032-01-01", "2032-03-26", "2032-03-29", "2032-05-03",
  "2032-05-31", "2032-08-30", "2032-12-27", "2032-12-28",
  // 2033
  "2033-01-03", "2033-04-15", "2033-04-18", "2033-05-02",
  "2033-05-30", "2033-08-29", "2033-12-26", "2033-12-27",
  // 2034
  "2034-01-02", "2034-04-07", "2034-04-10", "2034-05-01",
  "2034-05-29", "2034-08-28", "2034-12-25", "2034-12-26",
  // 2035
  "2035-01-01", "2035-03-23", "2035-03-26", "2035-05-07",
  "2035-05-28", "2035-08-27", "2035-12-25", "2035-12-26",
]);

// US market holidays 2025-2035
export const US_HOLIDAYS: Set<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18",
  "2025-05-26", "2025-06-19", "2025-07-04", "2025-09-01",
  "2025-11-27", "2025-12-25",
  // 2026
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-04-03",
  "2026-05-25", "2026-06-19", "2026-07-03", "2026-09-07",
  "2026-11-26", "2026-12-25",
  // 2027
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26",
  "2027-05-31", "2027-06-18", "2027-07-05", "2027-09-06",
  "2027-11-25", "2027-12-24",
  // 2028
  "2028-01-17", "2028-02-21", "2028-04-14",
  "2028-05-29", "2028-06-19", "2028-07-04", "2028-09-04",
  "2028-11-23", "2028-12-25",
  // 2029
  "2029-01-01", "2029-01-15", "2029-02-19", "2029-03-30",
  "2029-05-28", "2029-06-19", "2029-07-04", "2029-09-03",
  "2029-11-22", "2029-12-25",
  // 2030
  "2030-01-01", "2030-01-21", "2030-02-18", "2030-04-19",
  "2030-05-27", "2030-06-19", "2030-07-04", "2030-09-02",
  "2030-11-28", "2030-12-25",
  // 2031
  "2031-01-01", "2031-01-20", "2031-02-17", "2031-04-11",
  "2031-05-26", "2031-06-19", "2031-07-04", "2031-09-01",
  "2031-11-27", "2031-12-25",
  // 2032
  "2032-01-01", "2032-01-19", "2032-02-16", "2032-03-26",
  "2032-05-31", "2032-06-18", "2032-07-05", "2032-09-06",
  "2032-11-25", "2032-12-24",
  // 2033
  "2033-01-17", "2033-02-21", "2033-04-15",
  "2033-05-30", "2033-06-20", "2033-07-04", "2033-09-05",
  "2033-11-24", "2033-12-26",
  // 2034
  "2034-01-02", "2034-01-16", "2034-02-20", "2034-04-07",
  "2034-05-29", "2034-06-19", "2034-07-04", "2034-09-04",
  "2034-11-23", "2034-12-25",
  // 2035
  "2035-01-01", "2035-01-21", "2035-02-19", "2035-03-23",
  "2035-05-28", "2035-06-19", "2035-07-04", "2035-09-03",
  "2035-11-22", "2035-12-25",
]);

interface MarketWindow {
  name: string;
  openHour: number;
  openMinute: number;
  closeHour: number;
  closeMinute: number;
  blackoutMinutesBefore: number;
  holidays: Set<string>;
}

const MARKET_WINDOWS: MarketWindow[] = [
  {
    name: "LSE",
    openHour: 8,
    openMinute: 0,
    closeHour: 16,
    closeMinute: 35,
    blackoutMinutesBefore: 5, // stop at 16:30
    holidays: UK_BANK_HOLIDAYS,
  },
  {
    name: "US",
    openHour: 14,
    openMinute: 30,
    closeHour: 21,
    closeMinute: 0,
    blackoutMinutesBefore: 5, // stop at 20:55
    holidays: US_HOLIDAYS,
  },
];

/**
 * Check if ANY market is currently open (UK time).
 * Returns false during close-auction blackout window.
 */
export function isMarketOpen(now: Date = new Date()): boolean {
  // Get UK time components using Intl formatter
  const fmt = (part: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", [part]: "numeric" } as Intl.DateTimeFormatOptions)
      .format(now);

  const year = parseInt(fmt("year"), 10);
  const month = parseInt(fmt("month"), 10);
  const day = parseInt(fmt("day"), 10);
  const hours = parseInt(fmt("hour"), 10);
  const minutes = parseInt(fmt("minute"), 10);

  // Get weekday (0=Sun, 6=Sat) — with fallback if Intl returns unexpected format
  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" })
    .format(now);
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let dayOfWeek = weekdayMap[weekday] ?? -1;
  if (dayOfWeek === -1) {
    // Fallback: use UTC day (close enough for weekend detection)
    dayOfWeek = now.getUTCDay();
  }

  // Weekend
  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const timeInMinutes = hours * 60 + minutes;

  for (const window of MARKET_WINDOWS) {
    // Skip if holiday for this market
    if (window.holidays.has(dateStr)) continue;

    const openTime = window.openHour * 60 + window.openMinute;
    const closeTime = window.closeHour * 60 + window.closeMinute;
    const blackoutTime = closeTime - window.blackoutMinutesBefore;

    // Within market hours and not in blackout
    if (timeInMinutes >= openTime && timeInMinutes < blackoutTime) {
      return true;
    }
  }

  return false;
}

/**
 * Check if a date is a valid trading day (weekday + not a holiday).
 * Unlike isMarketOpen(), does NOT check intraday hours — suitable for
 * post-close scripts like nightlyScan.
 */
export function isTradingDay(now: Date = new Date()): boolean {
  const fmtPart = (part: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", [part]: "numeric" } as Intl.DateTimeFormatOptions)
      .format(now);

  const year = parseInt(fmtPart("year"), 10);
  const month = parseInt(fmtPart("month"), 10);
  const day = parseInt(fmtPart("day"), 10);

  const weekday = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" })
    .format(now);
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  let dayOfWeek = weekdayMap[weekday] ?? -1;
  if (dayOfWeek === -1) dayOfWeek = now.getUTCDay();

  if (dayOfWeek === 0 || dayOfWeek === 6) return false;

  const dateStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

  // Both UK and US markets closed → not a trading day
  if (UK_BANK_HOLIDAYS.has(dateStr) && US_HOLIDAYS.has(dateStr)) return false;

  return true;
}
