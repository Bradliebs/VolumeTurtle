import {
  canAutoCloseTrade,
  findDuplicateClosedEntryIds,
  findDuplicateClosedTradeIds,
  findPhantomClosedTradeIds,
} from "@/lib/trades/status";

describe("canAutoCloseTrade", () => {
  it("allows auto-close when Trading 212 is not configured", () => {
    expect(canAutoCloseTrade({ t212Configured: false, t212Loaded: false, t212StillHeld: false })).toBe(true);
  });

  it("blocks auto-close when Trading 212 is configured but holdings are unavailable", () => {
    expect(canAutoCloseTrade({ t212Configured: true, t212Loaded: false, t212StillHeld: false })).toBe(false);
  });

  it("blocks auto-close when Trading 212 still shows the position", () => {
    expect(canAutoCloseTrade({ t212Configured: true, t212Loaded: true, t212StillHeld: true })).toBe(false);
  });

  it("allows auto-close when Trading 212 confirms the position is gone", () => {
    expect(canAutoCloseTrade({ t212Configured: true, t212Loaded: true, t212StillHeld: false })).toBe(true);
  });
});

describe("findPhantomClosedTradeIds", () => {
  it("returns the latest closed trade for a currently held but untracked ticker", () => {
    const phantomIds = findPhantomClosedTradeIds({
      openTrades: [{ ticker: "AAPL" }],
      heldTickers: ["SPIR", "AAPL"],
      closedTrades: [
        {
          id: "spir-old",
          ticker: "SPIR",
          entryDate: "2026-03-01T00:00:00.000Z",
          exitDate: "2026-03-05T00:00:00.000Z",
        },
        {
          id: "spir-latest",
          ticker: "SPIR",
          entryDate: "2026-04-04T00:00:00.000Z",
          exitDate: "2026-04-08T00:00:00.000Z",
        },
        {
          id: "aapl-closed",
          ticker: "AAPL",
          entryDate: "2026-02-01T00:00:00.000Z",
          exitDate: "2026-02-07T00:00:00.000Z",
        },
      ],
    });

    expect(phantomIds).toEqual(new Set(["spir-latest"]));
  });

  it("returns no ids when the held ticker is already tracked as open", () => {
    const phantomIds = findPhantomClosedTradeIds({
      openTrades: [{ ticker: "SPIR" }],
      heldTickers: ["SPIR"],
      closedTrades: [
        {
          id: "spir-history",
          ticker: "SPIR",
          entryDate: "2026-01-01T00:00:00.000Z",
          exitDate: "2026-01-10T00:00:00.000Z",
        },
      ],
    });

    expect(phantomIds.size).toBe(0);
  });
});

describe("findDuplicateClosedTradeIds", () => {
  it("returns closed ids that have a matching open twin", () => {
    const duplicateIds = findDuplicateClosedTradeIds({
      openTrades: [
        {
          id: "open-spir",
          ticker: "SPIR",
          entryDate: "2026-04-04T09:28:42.217Z",
          entryPrice: 19.99980402,
          shares: 13.35963091,
        },
      ],
      closedTrades: [
        {
          id: "closed-spir",
          ticker: "SPIR",
          entryDate: "2026-04-04T09:28:42.217Z",
          exitDate: "2026-04-08T00:00:00.000Z",
          entryPrice: 19.99980402,
          shares: 13.35963091,
        },
        {
          id: "closed-other",
          ticker: "SPIR",
          entryDate: "2026-03-04T09:28:42.217Z",
          exitDate: "2026-03-08T00:00:00.000Z",
          entryPrice: 18,
          shares: 10,
        },
      ],
    });

    expect(duplicateIds).toEqual(new Set(["closed-spir"]));
  });

  it("returns no ids when the open trade is a distinct position", () => {
    const duplicateIds = findDuplicateClosedTradeIds({
      openTrades: [
        {
          id: "open-spir",
          ticker: "SPIR",
          entryDate: "2026-04-05T09:28:42.217Z",
          entryPrice: 21,
          shares: 14,
        },
      ],
      closedTrades: [
        {
          id: "closed-spir",
          ticker: "SPIR",
          entryDate: "2026-04-04T09:28:42.217Z",
          exitDate: "2026-04-08T00:00:00.000Z",
          entryPrice: 19.99980402,
          shares: 13.35963091,
        },
      ],
    });

    expect(duplicateIds.size).toBe(0);
  });
});

describe("findDuplicateClosedEntryIds", () => {
  it("marks older closed twins as duplicates and keeps the newest", () => {
    const duplicates = findDuplicateClosedEntryIds([
      {
        id: "bk-latest",
        ticker: "BKSY",
        entryDate: "2026-04-04T09:28:42.217Z",
        entryPrice: 33.44975671,
        shares: 8.02128405,
        exitDate: "2026-04-08T00:00:00.000Z",
        createdAt: "2026-04-08T09:40:46.242Z",
      },
      {
        id: "bk-old-1",
        ticker: "BKSY",
        entryDate: "2026-04-04T09:28:42.217Z",
        entryPrice: 33.44975671,
        shares: 8.02128405,
        exitDate: "2026-04-07T00:00:00.000Z",
        createdAt: "2026-04-07T19:09:25.303Z",
      },
      {
        id: "bk-old-2",
        ticker: "BKSY",
        entryDate: "2026-04-04T09:28:42.217Z",
        entryPrice: 33.44975671,
        shares: 8.02128405,
        exitDate: "2026-04-07T00:00:00.000Z",
        createdAt: "2026-04-07T17:17:51.320Z",
      },
      {
        id: "other",
        ticker: "CBIO",
        entryDate: "2026-03-30T09:28:42.217Z",
        entryPrice: 15.39,
        shares: 20,
        exitDate: "2026-04-02T00:00:00.000Z",
        createdAt: "2026-04-02T09:40:46.242Z",
      },
    ]);

    expect(duplicates).toEqual(new Set(["bk-old-1", "bk-old-2"]));
  });

  it("returns no duplicates for distinct closed positions", () => {
    const duplicates = findDuplicateClosedEntryIds([
      {
        id: "a1",
        ticker: "BKSY",
        entryDate: "2026-04-04T09:28:42.217Z",
        entryPrice: 33,
        shares: 8,
        exitDate: "2026-04-08T00:00:00.000Z",
        createdAt: "2026-04-08T09:40:46.242Z",
      },
      {
        id: "a2",
        ticker: "BKSY",
        entryDate: "2026-04-06T09:28:42.217Z",
        entryPrice: 34,
        shares: 8,
        exitDate: "2026-04-09T00:00:00.000Z",
        createdAt: "2026-04-09T09:40:46.242Z",
      },
    ]);

    expect(duplicates.size).toBe(0);
  });
});