export interface TimingInput {
  close: number;
  high: number;
  low: number;
  volume: number;
  avgVolume20: number;
  atr14: number;
  entryDate: Date;
}

export interface TimingResult {
  closeStrength: number;
  volumeExpansion: number;
  rangeStability: number;
  timingScore: number;
  flowFlag: boolean;
  flowType: string | null;
  timingGatePass: boolean;
  positionSizeMultiplier: number;
}

type FlowWindow = { flowFlag: boolean; flowType: string | null };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function toUtcDateOnly(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function sameUtcDate(left: Date, right: Date): boolean {
  return left.getUTCFullYear() === right.getUTCFullYear()
    && left.getUTCMonth() === right.getUTCMonth()
    && left.getUTCDate() === right.getUTCDate();
}

function isWeekday(date: Date): boolean {
  const day = date.getUTCDay();
  return day >= 1 && day <= 5;
}

function addTradingDays(date: Date, tradingDays: number): Date {
  if (tradingDays === 0) return toUtcDateOnly(date);

  const step = tradingDays > 0 ? 1 : -1;
  const result = toUtcDateOnly(date);
  let remaining = Math.abs(tradingDays);

  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + step);
    if (isWeekday(result)) {
      remaining -= 1;
    }
  }

  return result;
}

function getThirdFridayOfMonth(date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const firstDay = new Date(Date.UTC(year, month, 1));
  const firstDayDow = firstDay.getUTCDay();
  const fridayDow = 5;
  const firstFridayOffset = (fridayDow - firstDayDow + 7) % 7;
  const firstFridayDate = 1 + firstFridayOffset;
  const thirdFridayDate = firstFridayDate + 14;
  return new Date(Date.UTC(year, month, thirdFridayDate));
}

function getLastCalendarDayOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

export function calculateCloseStrength(close: number, high: number, low: number): number {
  if (high === low) return 0.5;
  const raw = (close - low) / (high - low);
  return clamp(raw, 0, 1);
}

export function calculateVolumeExpansion(volume: number, avgVolume20: number): number {
  if (avgVolume20 === 0) return 1.0;
  const raw = volume / avgVolume20;
  return clamp(raw, 0, 5);
}

export function calculateRangeStability(high: number, low: number, atr14: number): number {
  if (atr14 === 0) return 1.0;
  const dayRange = Math.max(0, high - low);
  return dayRange / atr14;
}

export function detectFlowWindow(date: Date): FlowWindow {
  const d = toUtcDateOnly(date);

  const lastDay = getLastCalendarDayOfMonth(d);
  const daysToMonthEnd = lastDay.getUTCDate() - d.getUTCDate();
  const isMonthEndWindow = daysToMonthEnd >= 0 && daysToMonthEnd <= 2;

  const month = d.getUTCMonth();
  const isQuarterEndMonth = month === 2 || month === 5 || month === 8 || month === 11;
  const isQuarterEndWindow = isQuarterEndMonth && daysToMonthEnd >= 0 && daysToMonthEnd <= 4;

  if (isQuarterEndWindow) {
    return { flowFlag: true, flowType: "QUARTER_END" };
  }

  if (isMonthEndWindow) {
    return { flowFlag: true, flowType: "MONTH_END" };
  }

  if (isWeekday(d)) {
    const thirdFriday = getThirdFridayOfMonth(d);
    const opexWindow: Date[] = [
      addTradingDays(thirdFriday, -2),
      addTradingDays(thirdFriday, -1),
      thirdFriday,
      addTradingDays(thirdFriday, 1),
      addTradingDays(thirdFriday, 2),
    ];

    if (opexWindow.some((windowDate) => sameUtcDate(windowDate, d))) {
      return { flowFlag: true, flowType: "OPEX" };
    }
  }

  return { flowFlag: false, flowType: null };
}

export function scoreTimingGate(input: TimingInput): TimingResult {
  const closeStrength = calculateCloseStrength(input.close, input.high, input.low);
  const volumeExpansion = calculateVolumeExpansion(input.volume, input.avgVolume20);
  const rangeStability = calculateRangeStability(input.high, input.low, input.atr14);
  const flow = detectFlowWindow(input.entryDate);

  const closeStrengthPoints = closeStrength * 35;
  const volumeExpansionPoints = volumeExpansion >= 1.2 ? 25 : volumeExpansion >= 1.0 ? 15 : 0;
  const rangeStabilityPoints = rangeStability >= 0.5 && rangeStability <= 2.0 ? 20 : 0;
  const flowPoints = flow.flowFlag ? 10 : 0;
  const MARKET_ALIGNMENT_RESERVED = 0;

  const timingScore = clamp(
    closeStrengthPoints + volumeExpansionPoints + rangeStabilityPoints + flowPoints + MARKET_ALIGNMENT_RESERVED,
    0,
    100,
  );

  const timingGatePass = timingScore >= 70;

  let positionSizeMultiplier = 0;
  if (timingGatePass && flow.flowFlag) {
    positionSizeMultiplier = 1.3;
  } else if (timingGatePass && timingScore >= 80) {
    positionSizeMultiplier = 1.0;
  } else if (timingGatePass) {
    positionSizeMultiplier = 0.85;
  }

  return {
    closeStrength,
    volumeExpansion,
    rangeStability,
    timingScore,
    flowFlag: flow.flowFlag,
    flowType: flow.flowType,
    timingGatePass,
    positionSizeMultiplier,
  };
}