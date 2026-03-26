import type { ExitReason, TradeStatus } from "@/lib/trades/types";

export interface AccountSnapshot {
  id: string;
  date: string;
  balance: number;
  openTrades: number;
}

export interface Trade {
  id: string;
  ticker: string;
  entryDate: string;
  entryPrice: number;
  shares: number;
  hardStop: number;
  trailingStop: number;
  exitDate: string | null;
  exitPrice: number | null;
  exitReason: ExitReason | null;
  rMultiple: number | null;
  status: TradeStatus;
  volumeRatio: number;
  rangePosition: number;
  atr20: number;
  importedFromT212: boolean;
  importedAt: string | null;
}

export interface ScanResult {
  id: string;
  scanDate: string;
  ticker: string;
  signalFired: boolean;
  volumeRatio: number | null;
  rangePosition: number | null;
  atr20: number | null;
  compositeScore: number | null;
  compositeGrade: string | null;
  actionTaken: string | null;
}

export interface StopHistoryEntry {
  id: string;
  date: string;
  stopLevel: number;
  stopType: string;
  changed: boolean;
  changeAmount: number | null;
  note: string | null;
}

export interface ActionItem {
  type: string;
  ticker: string;
  message: string;
  urgency: string;
  stopHistoryId?: string;
}

export interface Instruction {
  ticker: string;
  currency: string;
  type: "HOLD" | "UPDATE_STOP" | "EXIT" | "T212_EXIT" | "T212_STOP_BEHIND";
  currentStop: number;
  stopSetDate: string | null;
  latestClose: number | null;
  oldStop: number | null;
  newStop: number | null;
  changeAmount: number | null;
  breakAmount: number | null;
  actioned: boolean;
  t212Stop: number | null;
}

export interface TradeWithHistory extends Trade {
  stopHistory: StopHistoryEntry[];
}

export interface T212ScanEntry {
  date: string;
  signalFired: boolean;
  compositeGrade: string | null;
  compositeScore: number | null;
  volumeRatio: number | null;
  rangePosition: number | null;
  actionTaken: string | null;
}

export interface T212PortfolioPosition {
  ticker: string;
  quantity: number;
  averagePrice: number;
  currentPrice: number;
  ppl: number;
  stopLoss: number | null;
  tracked: boolean;
  suggestedHardStop: number | null;
  suggestedTrailingStop: number | null;
  suggestedActiveStop: number | null;
  atr20: number | null;
  scanHistory: T212ScanEntry[];
  lastSignalDate: string | null;
  lastSignalGrade: string | null;
  tradeStatus: string | null;
}

export interface DashboardData {
  account: AccountSnapshot | null;
  openTrades: TradeWithHistory[];
  recentSignals: ScanResult[];
  closedTrades: Trade[];
  lastScanTime: string | null;
  actions: ActionItem[];
  instructions: Instruction[];
  scheduledScans: {
    lse: ScheduledScanStatus;
    us: ScheduledScanStatus;
  };
  scanHistory: ScanHistoryEntry[];
  regime: RegimeData | null;
  equityCurve: EquityCurveData | null;
  sparklineSnapshots: SnapshotForSparkline[];
  lastBackupAt: string | null;
  t212Portfolio: T212PortfolioPosition[] | null;
  t212Prices: Record<string, { currentPrice: number; ppl: number; stopLoss: number | null }>;
}

export interface EquityCurveData {
  systemState: "NORMAL" | "CAUTION" | "PAUSE";
  currentBalance: number;
  peakBalance: number;
  drawdownPct: number;
  drawdownAbs: number;
  equityMA20: number | null;
  aboveEquityMA: boolean;
  riskPctPerTrade: number;
  maxPositions: number;
  reason: string;
}

export interface SnapshotForSparkline {
  date: string;
  balance: number;
}

export interface RegimeData {
  marketRegime: "BULLISH" | "BEARISH";
  qqqClose: number;
  qqq200MA: number;
  qqqPctAboveMA: number;
  volatilityRegime: "NORMAL" | "ELEVATED" | "PANIC";
  vixLevel: number | null;
  asOf: string;
}

export interface RegimeAssessmentData {
  overallSignal: "STRONG" | "CAUTION" | "AVOID";
  warnings: string[];
  score: number;
  regime: {
    marketRegime: string;
    qqqClose: number;
    qqq200MA: number;
    qqqPctAboveMA: number;
    volatilityRegime: string;
    vixLevel: number | null;
  };
  tickerRegime: {
    ticker: string;
    tickerTrend: string;
    close: number;
    ma50: number | null;
    pctAboveMA50: number | null;
  };
}

export interface ScheduledScanStatus {
  nextRun: string;
  nextRunIso: string;
  lastRun: string | null;
  lastRunSignals: number | null;
  missed: boolean;
}

export interface ScanHistoryEntry {
  id: number;
  startedAt: string;
  completedAt: string | null;
  tickersScanned: number;
  signalsFound: number;
  status: string;
  trigger: string;
  market: string;
  durationMs: number | null;
  marketRegime: string | null;
  vixLevel: number | null;
}

export interface CompositeScoreData {
  total: number;
  components: {
    regimeScore: number;
    trendScore: number;
    volumeScore: number;
    liquidityScore: number;
  };
  grade: "A" | "B" | "C" | "D";
  gradeReason: string;
}

export interface SignalFired {
  ticker: string;
  currency: string;
  date: string;
  close: number;
  volume: number;
  avgVolume20: number;
  volumeRatio: number;
  rangePosition: number;
  atr20: number;
  suggestedEntry: number;
  hardStop: number;
  riskPerShare: number;
  positionSize: {
    shares: number;
    totalExposure: number;
    dollarRisk: number;
    exposurePercent: number;
    exposureWarning: string | null;
    equityState: string | null;
    effectiveRiskPct: number;
  } | null;
  regimeAssessment: RegimeAssessmentData | null;
  compositeScore: CompositeScoreData | null;
  avgDollarVolume20: number;
}

export interface NearMiss {
  ticker: string;
  volumeRatio: number;
  rangePosition: number;
  failedOn: "VOLUME" | "RANGE" | "LIQUIDITY";
  potentialScore?: number;
  potentialGrade?: string;
}

export interface ScanResponse {
  date: string;
  dryRun: boolean;
  summary: { signalCount: number; entered: number; exited: number };
  signalsFired: SignalFired[];
  tradesEntered: { ticker: string; shares: number; suggestedEntry: number; hardStop: number }[];
  tradesExited: { ticker: string; exitPrice: number; rMultiple: number }[];
  nearMisses: NearMiss[];
  openPositions: number;
  balance: number;
  regime?: RegimeData;
  equityCurve?: EquityCurveData;
  error?: string;
}

export interface T212PositionData {
  currentPrice: number;
  quantity: number;
  averagePrice: number;
  ppl: number;
  stopLoss: number | null;
  confirmed: boolean;
}

export interface SyncResult {
  tradeId: string;
  ticker: string;
  trade?: TradeWithHistory;
  latestClose?: number;
  latestCloseDate?: string;
  syncedAt?: string;
  stopChanged?: boolean;
  previousStop?: number;
  instruction?: { type: string; message: string; urgent: boolean };
  t212?: T212PositionData | null;
  error?: string;
}
