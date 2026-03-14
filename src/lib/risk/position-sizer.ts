export interface PositionCalc {
  entryPrice: number;
  stopPrice: number;
  targetPrice: number | null;
  positionSize: number;
  riskAmount: number;
  riskReward: number | null;
}

export interface PositionInput {
  entryPrice: number;
  stopPrice: number;
  targetPrice?: number;
  accountSize: number;
  riskPercent: number; // e.g. 0.01 for 1%
}

/**
 * Calculate position size and risk metrics.
 */
export function calculatePosition(input: PositionInput): PositionCalc {
  const { entryPrice, stopPrice, accountSize, riskPercent } = input;

  const riskPerShare = Math.abs(entryPrice - stopPrice);
  if (riskPerShare === 0) {
    throw new Error("Entry and stop price cannot be equal");
  }

  const riskAmount = accountSize * riskPercent;
  const positionSize = Math.floor(riskAmount / riskPerShare);

  let riskReward: number | null = null;
  if (input.targetPrice !== undefined) {
    const rewardPerShare = Math.abs(input.targetPrice - entryPrice);
    riskReward = Math.round((rewardPerShare / riskPerShare) * 100) / 100;
  }

  return {
    entryPrice,
    stopPrice,
    targetPrice: input.targetPrice ?? null,
    positionSize,
    riskAmount,
    riskReward,
  };
}
