import { calculateTrueRange, calculateATR } from "@/lib/risk/atr";
import type { DailyQuote } from "@/lib/data/fetchQuotes";
import { generateQuotes, makeQuote } from "../../helpers";

// Mock config to avoid env var validation
jest.mock("@/lib/config", () => require("../../__mocks__/config"));

describe("calculateTrueRange", () => {
  it("returns high - low when it is the largest range", () => {
    const prev = makeQuote({ date: "2025-01-01", close: 100 });
    const curr = makeQuote({ date: "2025-01-02", high: 120, low: 80, close: 110 });
    // H-L = 40, |H-prevC| = 20, |L-prevC| = 20
    expect(calculateTrueRange(prev, curr)).toBe(40);
  });

  it("uses |high - prevClose| when gap up", () => {
    const prev = makeQuote({ date: "2025-01-01", close: 50 });
    const curr = makeQuote({ date: "2025-01-02", high: 120, low: 100, close: 110 });
    // H-L = 20, |H-prevC| = 70, |L-prevC| = 50
    expect(calculateTrueRange(prev, curr)).toBe(70);
  });

  it("uses |low - prevClose| when gap down", () => {
    const prev = makeQuote({ date: "2025-01-01", close: 200 });
    const curr = makeQuote({ date: "2025-01-02", high: 105, low: 95, close: 100 });
    // H-L = 10, |H-prevC| = 95, |L-prevC| = 105
    expect(calculateTrueRange(prev, curr)).toBe(105);
  });

  it("returns 0 when all values are equal", () => {
    const prev = makeQuote({ date: "2025-01-01", close: 100 });
    const curr = makeQuote({ date: "2025-01-02", high: 100, low: 100, close: 100 });
    expect(calculateTrueRange(prev, curr)).toBe(0);
  });
});

describe("calculateATR", () => {
  it("returns null when fewer than 6 quotes", () => {
    const quotes = generateQuotes(5);
    expect(calculateATR(quotes, 14)).toBeNull();
  });

  it("returns a value with fewer than period+1 quotes if >= 6", () => {
    const quotes = generateQuotes(10);
    expect(calculateATR(quotes, 14)).not.toBeNull();
  });

  it("returns a value for exactly period quotes when >= 6", () => {
    const quotes = generateQuotes(14);
    expect(calculateATR(quotes, 14)).not.toBeNull();
  });

  it("returns a number when given exactly period+1 quotes", () => {
    const quotes = generateQuotes(15, { basePrice: 100, spread: 5 });
    const atr = calculateATR(quotes, 14);
    expect(atr).not.toBeNull();
    expect(typeof atr).toBe("number");
    expect(atr!).toBeGreaterThan(0);
  });

  it("returns ATR for 21 quotes with period 20", () => {
    const quotes = generateQuotes(25, { basePrice: 100, spread: 3 });
    const atr = calculateATR(quotes, 20);
    expect(atr).not.toBeNull();
    expect(atr!).toBeGreaterThan(0);
  });

  it("computes correct initial SMA ATR for uniform data", () => {
    // All bars identical → TR should be 0 for all
    const quotes: DailyQuote[] = [];
    for (let i = 0; i < 16; i++) {
      quotes.push(makeQuote({
        date: `2025-01-${String(i + 1).padStart(2, "0")}`,
        open: 100, high: 100, low: 100, close: 100,
      }));
    }
    const atr = calculateATR(quotes, 14);
    expect(atr).toBe(0);
  });

  it("ATR increases with wider bars", () => {
    const narrow = generateQuotes(25, { basePrice: 100, spread: 1 });
    const wide = generateQuotes(25, { basePrice: 100, spread: 10 });
    const atrNarrow = calculateATR(narrow, 14)!;
    const atrWide = calculateATR(wide, 14)!;
    expect(atrWide).toBeGreaterThan(atrNarrow);
  });
});
