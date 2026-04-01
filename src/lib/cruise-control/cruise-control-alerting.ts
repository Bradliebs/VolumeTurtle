/**
 * Cruise Control — Alerting System
 *
 * Stores all alerts in DB for audit trail.
 * Delivers CRITICAL and WARNING alerts via Telegram (if configured).
 * INFO alerts are database-only.
 */

import { prisma } from "@/db/client";
import { sendTelegram } from "@/lib/telegram";
import { createLogger } from "@/lib/logger";

const log = createLogger("cruise-control-alerting");

// ── Types ───────────────────────────────────────────────────────────────────

export type AlertType = "critical" | "warning" | "info";

export interface CruiseControlAlertRecord {
  id: number;
  alertType: string;
  message: string;
  context: unknown;
  delivered: boolean;
  deliveredAt: Date | null;
  acknowledgedAt: Date | null;
  createdAt: Date;
}

// ── Typed Prisma Access ─────────────────────────────────────────────────────

const db = prisma as unknown as {
  cruiseControlAlert: {
    create: (args: {
      data: {
        alertType: string;
        message: string;
        context?: unknown;
        delivered?: boolean;
        deliveredAt?: Date;
      };
    }) => Promise<CruiseControlAlertRecord>;
    findMany: (args: {
      where?: Record<string, unknown>;
      orderBy?: Record<string, string>;
      take?: number;
    }) => Promise<CruiseControlAlertRecord[]>;
  };
};

// ── Alert Delivery ──────────────────────────────────────────────────────────

/**
 * Send an alert. Stores in DB always. Pushes via Telegram for critical/warning.
 */
export async function sendAlert(
  type: AlertType,
  message: string,
  context?: Record<string, unknown>,
): Promise<void> {
  const prefix = type === "critical"
    ? "🚨 [CRUISE-CONTROL-CRITICAL]"
    : type === "warning"
      ? "⚠️ [CRUISE-CONTROL-WARN]"
      : "ℹ️ [CRUISE-CONTROL]";

  const fullMessage = `${prefix} ${message}`;

  // Log at appropriate level
  if (type === "critical") {
    log.error({ context }, fullMessage);
  } else if (type === "warning") {
    log.warn({ context }, fullMessage);
  } else {
    log.info({ context }, fullMessage);
  }

  // Store in DB
  let delivered = false;
  let deliveredAt: Date | undefined;

  // Deliver via Telegram for critical and warning alerts
  if (type === "critical" || type === "warning") {
    try {
      await sendTelegram({
        text: `<b>${prefix}</b>\n${message}`,
        parseMode: "HTML",
      });
      delivered = true;
      deliveredAt = new Date();
    } catch (err) {
      log.warn(
        { err: String(err) },
        "Failed to deliver alert via Telegram — stored in DB only",
      );
    }
  }

  try {
    await db.cruiseControlAlert.create({
      data: {
        alertType: type,
        message: fullMessage,
        context: context ?? undefined,
        delivered,
        deliveredAt,
      },
    });
  } catch (err) {
    log.error({ err: String(err) }, "Failed to store alert in database");
  }
}

// ── Alert Retrieval ─────────────────────────────────────────────────────────

/**
 * Get recent alerts, optionally filtered by hours and type.
 */
export async function getRecentAlerts(
  hours = 24,
  type?: AlertType,
): Promise<CruiseControlAlertRecord[]> {
  const since = new Date();
  since.setHours(since.getHours() - hours);

  const where: Record<string, unknown> = {
    createdAt: { gte: since },
  };
  if (type) {
    where["alertType"] = type;
  }

  return db.cruiseControlAlert.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}
