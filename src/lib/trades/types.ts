/** Valid trade statuses. */
export type TradeStatus = "OPEN" | "CLOSED";

/** Valid exit reasons for closed trades. */
export type ExitReason = "HARD_STOP" | "TRAILING_STOP" | "MANUAL" | "T212_STOP";
