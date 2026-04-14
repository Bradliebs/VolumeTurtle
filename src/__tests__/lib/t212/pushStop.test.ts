/**
 * T212 stop push flow — tests for the cancel→wait→place→restore pipeline.
 */

jest.mock("@/lib/config", () => require("../../__mocks__/config"));

jest.mock("@/db/client", () => ({ prisma: {} }));

jest.mock("@/lib/logger", () => ({
  createLogger: () => ({ info: jest.fn(), warn: jest.fn(), error: jest.fn() }),
}));

jest.mock("@/lib/telegram", () => ({
  sendTelegram: jest.fn().mockResolvedValue(undefined),
}));

const mockGetInstruments = jest.fn();
const mockYahooToT212Ticker = jest.fn();
const mockGetPendingOrders = jest.fn();
const mockCancelOrder = jest.fn();
const mockPlaceStopOrder = jest.fn();
const mockLoadT212Settings = jest.fn();

jest.mock("@/lib/t212/client", () => ({
  loadT212Settings: (...args: unknown[]) => mockLoadT212Settings(...args),
  getInstruments: (...args: unknown[]) => mockGetInstruments(...args),
  yahooToT212Ticker: (...args: unknown[]) => mockYahooToT212Ticker(...args),
  getPendingOrders: (...args: unknown[]) => mockGetPendingOrders(...args),
  cancelOrder: (...args: unknown[]) => mockCancelOrder(...args),
  placeStopOrder: (...args: unknown[]) => mockPlaceStopOrder(...args),
}));

import { pushStopToT212 } from "@/lib/t212/pushStop";

const SETTINGS = { environment: "demo", apiKey: "k", apiSecret: "s", accountType: "isa" as const };
const INSTRUMENTS = [
  { ticker: "AAPL_US_EQ", shortName: "AAPL", currencyCode: "USD" },
  { ticker: "PMOl_EQ", shortName: "HBR", currencyCode: "GBX" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadT212Settings.mockReturnValue(SETTINGS);
  mockGetInstruments.mockResolvedValue(INSTRUMENTS);
  mockYahooToT212Ticker.mockImplementation((yahoo: string) => {
    if (yahoo === "AAPL") return "AAPL_US_EQ";
    if (yahoo === "HBR.L") return "PMOl_EQ";
    return null;
  });
  mockGetPendingOrders.mockResolvedValue([]);
  mockCancelOrder.mockResolvedValue(undefined);
  mockPlaceStopOrder.mockResolvedValue({ id: 999, ticker: "AAPL_US_EQ", type: "STOP" });
});

describe("pushStopToT212", () => {
  it("returns error when T212 settings not configured", async () => {
    mockLoadT212Settings.mockReturnValue(null);
    const result = await pushStopToT212("AAPL", 10, 150);
    expect(result.success).toBe(false);
    expect(result.error).toContain("not configured");
  });

  it("returns error when no instrument found", async () => {
    mockYahooToT212Ticker.mockReturnValue(null);
    const result = await pushStopToT212("UNKNOWN", 10, 100, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.error).toContain("No T212 instrument");
  });

  it("places stop successfully with no existing order", async () => {
    const result = await pushStopToT212("AAPL", 10, 150, SETTINGS);
    expect(result.success).toBe(true);
    expect(result.stopPrice).toBe(150);
    expect(result.cancelledOrderId).toBeNull();
    expect(result.placedOrder).toEqual({ id: 999, ticker: "AAPL_US_EQ", type: "STOP" });
    expect(result.error).toBeNull();
    expect(mockCancelOrder).not.toHaveBeenCalled();
    expect(mockPlaceStopOrder).toHaveBeenCalledWith(SETTINGS, "AAPL_US_EQ", 10, 150);
  });

  it("cancels existing stop before placing new one", async () => {
    mockGetPendingOrders.mockResolvedValue([
      { id: 111, ticker: "AAPL_US_EQ", type: "STOP_LIMIT", stopPrice: 140 },
    ]);

    const result = await pushStopToT212("AAPL", 10, 155, SETTINGS);
    expect(result.success).toBe(true);
    expect(result.cancelledOrderId).toBe(111);
    expect(mockCancelOrder).toHaveBeenCalledWith(SETTINGS, 111);
    expect(mockPlaceStopOrder).toHaveBeenCalledWith(SETTINGS, "AAPL_US_EQ", 10, 155);
  });

  it("converts GBX (pence) tickers — multiplies price by 100", async () => {
    const result = await pushStopToT212("HBR.L", 50, 2.5, SETTINGS);
    expect(result.success).toBe(true);
    // GBX: 2.5 GBP → 250 pence
    expect(mockPlaceStopOrder).toHaveBeenCalledWith(SETTINGS, "PMOl_EQ", 50, 250);
  });

  it("restores old stop when place fails after cancel", async () => {
    mockGetPendingOrders.mockResolvedValue([
      { id: 222, ticker: "AAPL_US_EQ", type: "STOP", stopPrice: 145 },
    ]);
    mockPlaceStopOrder
      .mockRejectedValueOnce(new Error("Rate limit"))
      .mockResolvedValueOnce({ id: 333, ticker: "AAPL_US_EQ", type: "STOP" });

    const result = await pushStopToT212("AAPL", 10, 160, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.restored).toBe(true);
    expect(result.error).toContain("old stop restored");
    // First call = new stop (fails), second call = restore old stop
    expect(mockPlaceStopOrder).toHaveBeenCalledTimes(2);
    expect(mockPlaceStopOrder).toHaveBeenNthCalledWith(2, SETTINGS, "AAPL_US_EQ", 10, 145);
  }, 15000);

  it("reports CRITICAL when both place and restore fail", async () => {
    mockGetPendingOrders.mockResolvedValue([
      { id: 222, ticker: "AAPL_US_EQ", type: "STOP", stopPrice: 145 },
    ]);
    mockPlaceStopOrder
      .mockRejectedValueOnce(new Error("Rate limit"))
      .mockRejectedValueOnce(new Error("Still rate limited"));

    const result = await pushStopToT212("AAPL", 10, 160, SETTINGS);
    expect(result.success).toBe(false);
    expect(result.error).toContain("NO STOP ACTIVE");
    expect(result.restored).toBeUndefined();
  }, 15000);

  it("proceeds when getPendingOrders fails (cancel error is caught)", async () => {
    // getPendingOrders throws inside a try/catch in the cancel block
    // The main function should still attempt to place the stop
    mockGetPendingOrders.mockRejectedValue(new Error("Network error"));
    const result = await pushStopToT212("AAPL", 10, 150, SETTINGS);
    expect(result.success).toBe(true);
    expect(result.cancelledOrderId).toBeNull();
    expect(mockPlaceStopOrder).toHaveBeenCalledWith(SETTINGS, "AAPL_US_EQ", 10, 150);
  });
});
