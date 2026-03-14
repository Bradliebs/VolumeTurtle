export interface SignalResult {
  symbol: string;
  date: Date;
  type: string;
  strength: number;
  metadata?: Record<string, unknown>;
}
