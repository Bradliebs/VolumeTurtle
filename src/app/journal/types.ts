// Journal analytics dashboard types

export interface PeriodStats {
  totalRR: number;
  pctReturn: number;
  profitGBP: number;
  winRate: number;
  wins: number;
  losses: number;
  breakeven: number;
}

export interface MonthStat {
  year: number;
  month: number;
  totalRR: number;
  profitGBP: number;
  winRate: number;
  tradeCount: number;
}

export interface BalancePoint {
  date: string;
  balance: number;
}

export interface JournalTrade {
  id: string;
  ticker: string;
  direction: "LONG";
  strategy: string;
  signalGrade: string | null;
  entryDate: string;
  exitDate: string | null;
  rr: number | null;
  pctReturn: number | null;
  profitGBP: number | null;
  status: "OPEN" | "CLOSED";
}

export interface AccountMetrics {
  balance: number;
  tradeRisk: number;
  riskValue: number;
}

export interface JournalData {
  periodStats: {
    week: PeriodStats;
    month: PeriodStats;
    year: PeriodStats;
    allTime: PeriodStats;
  };
  monthlyStats: MonthStat[];
  balanceHistory: BalancePoint[];
  closedTrades: JournalTrade[];
  openTrades: JournalTrade[];
  accountMetrics: AccountMetrics;
}

export type SignalSourceFilter = "all" | "volume" | "momentum" | "manual";
export type MetricView = "rr" | "net" | "profit" | "strike";
export type TimeRange = "H" | "D" | "W" | "M" | "3M" | "Y";
