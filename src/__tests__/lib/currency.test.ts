/**
 * Currency conversion — tests for GBP/USD/EUR conversion logic.
 */

import { getCurrencySymbol, isUsdTicker, isEurTicker, convertToGbp } from "@/lib/currency";

describe("getCurrencySymbol", () => {
  it("returns £ for LSE tickers", () => {
    expect(getCurrencySymbol("HBR.L")).toBe("£");
    expect(getCurrencySymbol("VOD.L")).toBe("£");
  });

  it("returns € for Amsterdam and Helsinki", () => {
    expect(getCurrencySymbol("ASML.AS")).toBe("€");
    expect(getCurrencySymbol("NOKIA.HE")).toBe("€");
  });

  it("returns $ for US tickers", () => {
    expect(getCurrencySymbol("AAPL")).toBe("$");
    expect(getCurrencySymbol("MSFT")).toBe("$");
  });
});

describe("isUsdTicker", () => {
  it("returns true for tickers without known suffix", () => {
    expect(isUsdTicker("AAPL")).toBe(true);
    expect(isUsdTicker("TSLA")).toBe(true);
  });

  it("returns false for LSE tickers", () => {
    expect(isUsdTicker("HBR.L")).toBe(false);
  });

  it("returns false for EUR tickers", () => {
    expect(isUsdTicker("ASML.AS")).toBe(false);
    expect(isUsdTicker("NOKIA.HE")).toBe(false);
  });
});

describe("isEurTicker", () => {
  it("returns true for .AS and .HE suffixes", () => {
    expect(isEurTicker("ASML.AS")).toBe(true);
    expect(isEurTicker("NOKIA.HE")).toBe(true);
  });

  it("returns false for LSE and US tickers", () => {
    expect(isEurTicker("HBR.L")).toBe(false);
    expect(isEurTicker("AAPL")).toBe(false);
  });
});

describe("convertToGbp", () => {
  const gbpUsdRate = 1.27;
  const gbpEurRate = 1.17;

  it("returns amount unchanged for GBP (.L) tickers", () => {
    expect(convertToGbp(100, "HBR.L", gbpUsdRate, gbpEurRate)).toBe(100);
  });

  it("converts USD tickers by dividing by GBP/USD rate", () => {
    const result = convertToGbp(127, "AAPL", gbpUsdRate, gbpEurRate);
    expect(result).toBeCloseTo(100, 1); // 127 / 1.27 = 100
  });

  it("converts EUR tickers by dividing by GBP/EUR rate", () => {
    const result = convertToGbp(117, "ASML.AS", gbpUsdRate, gbpEurRate);
    expect(result).toBeCloseTo(100, 1); // 117 / 1.17 = 100
  });

  it("falls through to raw amount for SEK/DKK tickers without EUR rate", () => {
    const result = convertToGbp(100, "VOLV.ST", gbpUsdRate);
    expect(result).toBe(100);
  });

  it("treats EUR ticker as unconverted if no EUR rate provided", () => {
    // Without gbpEurRate, EUR tickers aren't matched by isUsdTicker so fall through
    const result = convertToGbp(100, "ASML.AS", gbpUsdRate);
    expect(result).toBe(100);
  });
});
