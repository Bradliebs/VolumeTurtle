import { calculateRMultiple, buildStopHistoryData, tradeToOpenPosition } from "@/lib/trades/utils";

describe("calculateRMultiple", () => {
  it("returns positive R for winning trade", () => {
    // Entry 100, stop 90, exit 120 → risk=10, profit=20 → 2R
    expect(calculateRMultiple(120, 100, 90)).toBe(2);
  });

  it("returns negative R for losing trade", () => {
    // Entry 100, stop 90, exit 85 → risk=10, loss=-15 → -1.5R
    expect(calculateRMultiple(85, 100, 90)).toBe(-1.5);
  });

  it("returns 0 when exit equals entry", () => {
    expect(calculateRMultiple(100, 100, 90)).toBe(0);
  });

  it("returns 0 when risk per share is 0", () => {
    // hardStop equals entryPrice → division by zero guarded
    expect(calculateRMultiple(110, 100, 100)).toBe(0);
  });

  it("returns -1R at hard stop", () => {
    expect(calculateRMultiple(90, 100, 90)).toBe(-1);
  });
});

describe("buildStopHistoryData", () => {
  const date = new Date("2025-01-15");

  it("detects stop moved up", () => {
    const data = buildStopHistoryData("trade-1", date, 90, 95, 98);
    expect(data.changed).toBe(true);
    expect(data.changeAmount).toBe(3); // 98 - 95
    expect(data.stopLevel).toBe(98);
    expect(data.stopType).toBe("TRAILING");
  });

  it("detects no change", () => {
    const data = buildStopHistoryData("trade-1", date, 90, 95, 95);
    expect(data.changed).toBe(false);
    expect(data.changeAmount).toBeNull();
  });

  it("uses hard stop when it is higher", () => {
    const data = buildStopHistoryData("trade-1", date, 100, 95, 95);
    expect(data.stopLevel).toBe(100);
    expect(data.stopType).toBe("HARD");
  });

  it("includes tradeId and date", () => {
    const data = buildStopHistoryData("abc-123", date, 90, 95, 96);
    expect(data.tradeId).toBe("abc-123");
    expect(data.date).toBe(date);
  });
});

describe("tradeToOpenPosition", () => {
  it("converts a trade row to OpenPosition", () => {
    const trade = {
      ticker: "AAPL",
      entryDate: new Date("2025-01-10T14:30:00Z"),
      entryPrice: 150,
      shares: 10,
      hardStop: 140,
      trailingStop: 145,
    };

    const pos = tradeToOpenPosition(trade);
    expect(pos.ticker).toBe("AAPL");
    expect(pos.entryDate).toBe("2025-01-10");
    expect(pos.entryPrice).toBe(150);
    expect(pos.shares).toBe(10);
    expect(pos.hardStop).toBe(140);
    expect(pos.trailingStop).toBe(145);
    expect(pos.currentStop).toBe(145); // max(140, 145)
  });

  it("uses hardStop as currentStop when higher", () => {
    const trade = {
      ticker: "TSLA",
      entryDate: new Date("2025-01-10"),
      entryPrice: 200,
      shares: 5,
      hardStop: 180,
      trailingStop: 170,
    };

    const pos = tradeToOpenPosition(trade);
    expect(pos.currentStop).toBe(180);
  });
});
