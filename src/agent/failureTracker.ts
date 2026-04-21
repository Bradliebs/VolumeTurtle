import fs from "fs";
import path from "path";

/**
 * Tracks consecutive Claude API failures across agent cycles.
 *
 * Persisted to disk because each agent cycle runs as a fresh tsx process
 * (no in-memory state survives between runs). The runner increments on
 * Claude API errors and resets/deletes on success. context.ts reads the
 * count at the start of every cycle so the agent knows it's degraded.
 */

const FILE_DIR = path.join(
  process.env["USERPROFILE"] ?? "C:\\Users\\Default",
  "VolumeTurtle"
);
const FILE_PATH = path.join(FILE_DIR, "agent-failures.txt");

export function readFailureCount(): number {
  try {
    const raw = fs.readFileSync(FILE_PATH, "utf8").trim();
    const n = parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

export function incrementFailureCount(): number {
  const next = readFailureCount() + 1;
  try {
    fs.mkdirSync(FILE_DIR, { recursive: true });
    fs.writeFileSync(FILE_PATH, String(next), "utf8");
  } catch {
    // non-fatal — best effort
  }
  return next;
}

export function clearFailureCount(): void {
  try {
    fs.unlinkSync(FILE_PATH);
  } catch {
    // non-fatal — file may not exist
  }
}
