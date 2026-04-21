import { NextRequest, NextResponse } from "next/server";
import { execFile } from "child_process";
import { promisify } from "util";
import { rateLimit, getRateLimitKey } from "@/lib/rateLimit";

const execFileAsync = promisify(execFile);

const TASK_NAME = "VolumeTurtle_ExecutionScheduler";

interface SchtasksQueryRow {
  TaskName?: string;
  "Scheduled Task State"?: string;
  Status?: string;
}

async function queryTaskState(): Promise<{ enabled: boolean; exists: boolean; raw?: string }> {
  try {
    const { stdout } = await execFileAsync("schtasks", [
      "/query",
      "/tn",
      TASK_NAME,
      "/fo",
      "CSV",
      "/v",
    ]);
    // CSV: first line headers, second line values. We just need the "Scheduled Task State" column.
    const lines = stdout.split(/\r?\n/).filter((l) => l.trim().length > 0);
    if (lines.length < 2) {
      return { enabled: false, exists: false };
    }
    const header = (lines[0] ?? "").split('","').map((h) => h.replace(/^"|"$/g, ""));
    const values = (lines[1] ?? "").split('","').map((v) => v.replace(/^"|"$/g, ""));
    const row: SchtasksQueryRow = {};
    header.forEach((h, i) => { (row as Record<string, string>)[h] = values[i] ?? ""; });
    const state = row["Scheduled Task State"] ?? row.Status ?? "";
    return { enabled: state.toLowerCase() === "enabled", exists: true, raw: state };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // schtasks returns non-zero when task is not found
    if (/cannot find the file specified|the system cannot find/i.test(message)) {
      return { enabled: false, exists: false };
    }
    throw err;
  }
}

export async function GET(req: Request) {
  const limited = rateLimit(getRateLimitKey(req), 30, 60_000);
  if (limited) return limited;

  try {
    const state = await queryTaskState();
    return NextResponse.json({
      taskName: TASK_NAME,
      enabled: state.enabled,
      exists: state.exists,
      raw: state.raw ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function POST(req: NextRequest) {
  const limited = rateLimit(getRateLimitKey(req), 5, 60_000);
  if (limited) return limited;

  let body: { enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (typeof body.enabled !== "boolean") {
    return NextResponse.json(
      { error: "'enabled' (boolean) is required" },
      { status: 400 },
    );
  }

  const action = body.enabled ? "/enable" : "/disable";

  try {
    await execFileAsync("schtasks", ["/change", "/tn", TASK_NAME, action]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `schtasks failed: ${message}` },
      { status: 500 },
    );
  }

  // Re-query to confirm new state
  try {
    const state = await queryTaskState();
    return NextResponse.json({
      taskName: TASK_NAME,
      enabled: state.enabled,
      exists: state.exists,
      raw: state.raw ?? null,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
