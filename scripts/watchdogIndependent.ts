// Independent watchdog — runs OUTSIDE the Next.js dev server.
//
// Purpose: today the heartbeat lives inside a Next.js page; if the dev
// server dies, both the agent and the watchdog die with it. This script
// is self-contained — direct Postgres, native fetch, no @/ imports that
// require the Next build to succeed.
//
// Behaviour (every 10 min during market hours, Mon-Fri 07:45-21:15 UTC):
//   1. Ping TRADECORE_BASE_URL/api/health with DASHBOARD_TOKEN auth.
//   2. Read most recent AgentDecisionLog.createdAt straight from Postgres.
//   3. If server down → spawn `npx next dev`, wait 30s, ping again.
//   4. Telegram alerts:
//        - Down + restart failed   → 🔴
//        - Up but agent stale >90m → ⚠️
//        - Was down, now recovered → ✅
//   5. Append a single-line entry to watchdog-independent.log.
//
// Usage:
//   npx tsx scripts/watchdogIndependent.ts
//   npm run watchdog:independent

import "dotenv/config";
import { execFile } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

const STALE_THRESHOLD_MIN = 90;
const PING_TIMEOUT_MS = 5_000;
const RESTART_WAIT_MS = 30_000;

const LOG_DIR = join(
  process.env["USERPROFILE"] ?? process.env["HOME"] ?? ".",
  "VolumeTurtle",
  "logs",
);
const LOG_FILE = join(LOG_DIR, "watchdog-independent.log");

interface Status {
  serverUp: boolean;
  lastCycleMinutesAgo: number | null;
  stale: boolean;
}

/** Mon-Fri, 07:45-21:15 UTC. */
function isMarketHours(now: Date): boolean {
  const dow = now.getUTCDay(); // 0=Sun, 6=Sat
  if (dow === 0 || dow === 6) return false;
  const minutes = now.getUTCHours() * 60 + now.getUTCMinutes();
  return minutes >= 7 * 60 + 45 && minutes <= 21 * 60 + 15;
}

function timestamp(): string {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

function log(line: string): void {
  const entry = `[${timestamp()}] ${line}\n`;
  try {
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(LOG_FILE, entry);
  } catch {
    // ignore log failures — never crash the watchdog
  }
  // Mirror to stdout for Task Scheduler captures
  process.stdout.write(entry);
}

async function pingHealth(baseUrl: string, token: string | undefined): Promise<boolean> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(`${baseUrl}/api/health`, {
      method: "GET",
      headers,
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function sendTelegramDirect(text: string): Promise<void> {
  const botToken = process.env["TELEGRAM_BOT_TOKEN"];
  const chatId = process.env["TELEGRAM_CHAT_ID"];
  if (!botToken || !chatId) {
    log("WARN: TELEGRAM_BOT_TOKEN/CHAT_ID missing — cannot send alert");
    return;
  }
  const url = `https://api.telegram.org/bot${botToken}/sendMessage`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PING_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
      signal: controller.signal,
    });
    if (!res.ok) {
      log(`WARN: Telegram returned ${res.status}`);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    log(`WARN: Telegram send failed: ${msg}`);
  } finally {
    clearTimeout(timer);
  }
}

function startDevServer(installDir: string): void {
  // Detached, no-window background spawn so we never wait on it.
  // /b prevents a new console window; start launches it independently.
  execFile(
    "cmd",
    ["/c", "start", "/b", "npx", "next", "dev"],
    { cwd: installDir, windowsHide: true },
    () => { /* fire-and-forget */ },
  );
}

async function readLastAgentCycleMinutes(prisma: PrismaClient): Promise<number | null> {
  const db = prisma as unknown as {
    agentDecisionLog: {
      findFirst: (args: unknown) => Promise<{ createdAt: Date } | null>;
    };
  };
  try {
    const row = await db.agentDecisionLog.findFirst({
      orderBy: { createdAt: "desc" },
    } as unknown);
    if (!row) return null;
    const diffMs = Date.now() - row.createdAt.getTime();
    return Math.floor(diffMs / 60_000);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown";
    log(`ERROR: DB query failed: ${msg}`);
    return null;
  }
}

async function main(): Promise<void> {
  const now = new Date();
  if (!isMarketHours(now)) {
    // Quiet exit outside market hours
    return;
  }

  const baseUrl = process.env["TRADECORE_BASE_URL"] ?? "http://localhost:3000";
  const token = process.env["DASHBOARD_TOKEN"];
  const installDir = process.cwd();

  // Open Postgres directly — independent of any Next.js runtime.
  const connectionString = process.env["DATABASE_URL"];
  if (!connectionString) {
    log("FATAL: DATABASE_URL not set");
    process.exit(2);
  }
  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter }) as unknown as PrismaClient;

  try {
    // Phase 1: initial probe
    let serverUp = await pingHealth(baseUrl, token);
    let recovered = false;

    if (!serverUp) {
      log(`DOWN: ${baseUrl}/api/health unreachable — attempting restart`);
      startDevServer(installDir);
      await new Promise((r) => setTimeout(r, RESTART_WAIT_MS));
      serverUp = await pingHealth(baseUrl, token);
      if (serverUp) {
        recovered = true;
        log("RECOVERED: dev server back up after restart");
      } else {
        log("FAILED: dev server did not respond 30s after restart");
      }
    }

    const lastCycleMinutesAgo = await readLastAgentCycleMinutes(prisma);
    const stale =
      lastCycleMinutesAgo !== null && lastCycleMinutesAgo > STALE_THRESHOLD_MIN;

    const status: Status = { serverUp, lastCycleMinutesAgo, stale };

    log(
      `OK: serverUp=${status.serverUp} lastCycleMinutesAgo=${
        status.lastCycleMinutesAgo ?? "null"
      } stale=${status.stale}`,
    );

    // Phase 2: alerts
    if (!serverUp) {
      await sendTelegramDirect(
        "🔴 Dev server DOWN and restart failed — agent not running.\n" +
          `URL: ${baseUrl}/api/health\n` +
          `Last agent cycle: ${
            lastCycleMinutesAgo !== null ? `${lastCycleMinutesAgo}m ago` : "unknown"
          }`,
      );
    } else if (recovered) {
      await sendTelegramDirect(
        "✅ Dev server recovered after restart.\n" +
          `URL: ${baseUrl}\n` +
          `Last agent cycle: ${
            lastCycleMinutesAgo !== null ? `${lastCycleMinutesAgo}m ago` : "unknown"
          }`,
      );
    } else if (stale && lastCycleMinutesAgo !== null) {
      await sendTelegramDirect(
        `⚠️ Agent cycle stale — last cycle ${lastCycleMinutesAgo}m ago. ` +
          "Server is up but agent may be stuck.",
      );
    }
  } finally {
    try {
      await (prisma as unknown as { $disconnect: () => Promise<void> }).$disconnect();
    } catch {
      // ignore
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    const msg = err instanceof Error ? err.message : "Unknown";
    log(`FATAL: ${msg}`);
    process.exit(1);
  });
