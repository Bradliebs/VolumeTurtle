import { z } from "zod";

export const createTradeSchema = z.object({
  ticker: z.string().min(1, "Ticker is required"),
  suggestedEntry: z.number().positive("suggestedEntry must be positive"),
  hardStop: z.number().positive("hardStop must be positive"),
  shares: z.number().positive("shares must be positive"),
  riskPerShare: z.number().optional(),
  volumeRatio: z.number().optional(),
  rangePosition: z.number().optional(),
  atr20: z.number().optional(),
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
  }).optional(),
});

export const dangerActionSchema = z.object({
  action: z.enum(["clear-scans", "reset-positions", "reset-balance-history"], { error: "action must be 'clear-scans', 'reset-positions', or 'reset-balance-history'" }),
  confirm: z.literal("CONFIRM", { error: "Type CONFIRM to proceed" }),
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

