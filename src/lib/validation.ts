import { z } from "zod";

export const createTradeSchema = z.object({
  ticker: z.string().min(1, "Ticker is required"),
  suggestedEntry: z.number().positive("suggestedEntry must be positive"),
  hardStop: z.number().positive("hardStop must be positive"),
  shares: z.number().positive("shares must be positive"),
  close: z.number().optional(),
  high: z.number().optional(),
  low: z.number().optional(),
  volume: z.number().optional(),
  avgVolume20: z.number().optional(),
  atr14: z.number().optional(),
  riskPerShare: z.number().optional(),
  volumeRatio: z.number().optional(),
  rangePosition: z.number().optional(),
  atr20: z.number().optional(),
  signalSource: z.enum(["volume", "momentum", "manual"]).optional(),
  signalScore: z.number().optional(),
  signalGrade: z.string().optional(),
}).refine((data) => data.hardStop < data.suggestedEntry, {
  message: "hardStop must be below suggestedEntry",
  path: ["hardStop"],
});

export const closeTradeSchema = z.object({
  exitPrice: z.number({ error: "exitPrice is required" }),
});

export const updateBalanceSchema = z.object({
  balance: z.number().positive("balance must be a positive number"),
});

export const updateSettingsSchema = z.object({
  settings: z.record(z.string(), z.string()).optional(),
  t212: z.object({
    environment: z.enum(["demo", "live"]).optional(),
    accountType: z.enum(["invest", "isa", "both"]).optional(),
    apiKey: z.string().min(1).optional(),
    apiSecret: z.string().optional(),
  }).optional(),
});

export const dangerActionSchema = z.object({
  action: z.enum(["clear-scans", "reset-positions", "reset-balance-history"], { error: "action must be 'clear-scans', 'reset-positions', or 'reset-balance-history'" }),
  confirm: z.literal("CONFIRM", { error: "Type CONFIRM to proceed" }),
});

export const telegramSettingsSchema = z.object({
  botToken: z.string().min(1, "botToken is required").optional(),
  chatId: z.string().min(1, "chatId is required").optional(),
  enabled: z.boolean().optional(),
  sendTest: z.boolean().optional(),
}).refine(
  (data) => data.sendTest || (data.botToken && data.chatId),
  { message: "botToken and chatId are required when not sending a test", path: ["botToken"] },
);

export const executePendingSchema = z.object({
  orderId: z.number({ error: "orderId must be a number" }).int().positive().optional(),
  action: z.string().optional(),
}).refine(
  (data) => data.orderId != null || data.action != null,
  { message: "orderId or action is required" },
);

export const ratchetSchema = z.object({
  dryRun: z.boolean().optional().default(false),
});

/**
 * Parse and validate a request body against a Zod schema.
 * Returns { data } on success or { error, status } on failure.
 */
export async function validateBody<T extends z.ZodTypeAny>(
  request: Request,
  schema: T,
): Promise<
  | { data: z.infer<T>; error?: never }
  | { data?: never; error: string; status: 400 }
> {
  const body = await request.json().catch(() => null);
  if (body === null) {
    return { error: "Invalid JSON body", status: 400 };
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    const message = result.error.issues
      .map((i) => i.message)
      .join("; ");
    return { error: message, status: 400 };
  }

  return { data: result.data };
}

