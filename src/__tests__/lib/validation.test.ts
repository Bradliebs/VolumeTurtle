import {
  createTradeSchema,
  closeTradeSchema,
  updateBalanceSchema,
  updateSettingsSchema,
  dangerActionSchema,
} from "@/lib/validation";

describe("createTradeSchema", () => {
  const validTrade = {
    ticker: "AAPL",
    suggestedEntry: 150,
    hardStop: 140,
    shares: 10,
  };

  it("accepts a valid trade", () => {
    const result = createTradeSchema.safeParse(validTrade);
    expect(result.success).toBe(true);
  });

  it("accepts optional fields", () => {
    const result = createTradeSchema.safeParse({
      ...validTrade,
      riskPerShare: 10,
      volumeRatio: 2.5,
      rangePosition: 0.85,
      atr20: 3.2,
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty ticker", () => {
    const result = createTradeSchema.safeParse({ ...validTrade, ticker: "" });
    expect(result.success).toBe(false);
  });

  it("rejects negative suggestedEntry", () => {
    const result = createTradeSchema.safeParse({ ...validTrade, suggestedEntry: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects hardStop >= suggestedEntry", () => {
    const result = createTradeSchema.safeParse({ ...validTrade, hardStop: 150 });
    expect(result.success).toBe(false);
  });

  it("rejects hardStop equal to suggestedEntry", () => {
    const result = createTradeSchema.safeParse({ ...validTrade, hardStop: 150, suggestedEntry: 150 });
    expect(result.success).toBe(false);
  });

  it("rejects zero shares", () => {
    const result = createTradeSchema.safeParse({ ...validTrade, shares: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects missing ticker", () => {
    const { ticker: _, ...noTicker } = validTrade;
    const result = createTradeSchema.safeParse(noTicker);
    expect(result.success).toBe(false);
  });
});

describe("closeTradeSchema", () => {
  it("accepts valid exit price", () => {
    const result = closeTradeSchema.safeParse({ exitPrice: 155 });
    expect(result.success).toBe(true);
  });

  it("accepts zero exit price", () => {
    const result = closeTradeSchema.safeParse({ exitPrice: 0 });
    expect(result.success).toBe(true);
  });

  it("rejects missing exitPrice", () => {
    const result = closeTradeSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects string exitPrice", () => {
    const result = closeTradeSchema.safeParse({ exitPrice: "155" });
    expect(result.success).toBe(false);
  });
});

describe("updateBalanceSchema", () => {
  it("accepts positive balance", () => {
    const result = updateBalanceSchema.safeParse({ balance: 5000 });
    expect(result.success).toBe(true);
  });

  it("rejects zero balance", () => {
    const result = updateBalanceSchema.safeParse({ balance: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative balance", () => {
    const result = updateBalanceSchema.safeParse({ balance: -100 });
    expect(result.success).toBe(false);
  });
});

describe("updateSettingsSchema", () => {
  it("accepts empty object", () => {
    const result = updateSettingsSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it("accepts settings record", () => {
    const result = updateSettingsSchema.safeParse({
      settings: { riskPctPerTrade: "2", maxPositions: "5" },
    });
    expect(result.success).toBe(true);
  });

  it("accepts t212 config", () => {
    const result = updateSettingsSchema.safeParse({
      t212: { environment: "demo", accountType: "isa" },
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid t212 environment", () => {
    const result = updateSettingsSchema.safeParse({
      t212: { environment: "staging" },
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid t212 accountType", () => {
    const result = updateSettingsSchema.safeParse({
      t212: { accountType: "savings" },
    });
    expect(result.success).toBe(false);
  });
});

describe("dangerActionSchema", () => {
  it("accepts valid clear-scans with CONFIRM", () => {
    const result = dangerActionSchema.safeParse({ action: "clear-scans", confirm: "CONFIRM" });
    expect(result.success).toBe(true);
  });

  it("accepts valid reset-positions with CONFIRM", () => {
    const result = dangerActionSchema.safeParse({ action: "reset-positions", confirm: "CONFIRM" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid action", () => {
    const result = dangerActionSchema.safeParse({ action: "delete-all", confirm: "CONFIRM" });
    expect(result.success).toBe(false);
  });

  it("rejects wrong confirm text", () => {
    const result = dangerActionSchema.safeParse({ action: "clear-scans", confirm: "YES" });
    expect(result.success).toBe(false);
  });

  it("rejects missing confirm", () => {
    const result = dangerActionSchema.safeParse({ action: "clear-scans" });
    expect(result.success).toBe(false);
  });
});
