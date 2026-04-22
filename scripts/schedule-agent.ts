import { execSync, spawnSync } from "child_process";
import path from "path";

const INSTALL_DIR = path.resolve(__dirname, "..");
const LOG_DIR = path.join(process.env["USERPROFILE"] ?? "C:\\Users\\Default", "VolumeTurtle", "logs");

function minimizedPs(command: string): string {
  // Run task payload in a minimized PowerShell host to avoid full-size popups.
  return `powershell -NoProfile -WindowStyle Minimized -Command "Set-Location -LiteralPath '${INSTALL_DIR}'; ${command}"`;
}

const TASKS = [
  {
    name: "VolumeTurtle_Agent",
    description: "Agent cycle — hourly 08:00–23:00 weekdays",
    tr: minimizedPs(`npx tsx src/agent/runner.ts >> '${LOG_DIR}\\agent.log' 2>&1`),
    schedule: `/sc weekly /d MON,TUE,WED,THU,FRI /st 08:00 /ri 60 /du 15:00`,
  },
  {
    name: "VolumeTurtle_AgentListen",
    description: "Telegram listener — every 2 min 08:00–23:00 weekdays",
    tr: minimizedPs(`npx tsx src/agent/telegram-listener.ts >> '${LOG_DIR}\\agent-listen.log' 2>&1`),
    schedule: `/sc weekly /d MON,TUE,WED,THU,FRI /st 08:00 /ri 2 /du 15:00`,
  },
  {
    name: "VolumeTurtle_AgentSnapshot",
    description: "Sunday maintenance — universe snapshot at 18:00",
    tr: minimizedPs(`npx tsx src/agent/runner-sunday.ts >> '${LOG_DIR}\\agent-sunday.log' 2>&1`),
    schedule: `/sc weekly /d SUN /st 18:00`,
  },
  {
    name: "VolumeTurtle_AgentAutoTune",
    description: "Sunday maintenance — auto-tune at 19:00",
    tr: minimizedPs(`npx tsx src/agent/runner-sunday.ts >> '${LOG_DIR}\\agent-sunday.log' 2>&1`),
    schedule: `/sc weekly /d SUN /st 19:00`,
  },
  {
    name: "VolumeTurtle_AgentFriday",
    description: "Friday weekly debrief — 21:30 after US close",
    tr: minimizedPs(`npx tsx src/agent/runner-friday.ts >> '${LOG_DIR}\\agent-friday.log' 2>&1`),
    schedule: `/sc weekly /d FRI /st 21:30`,
  },
  {
    name: "VolumeTurtle_DivergenceTracker",
    description: "Weekly backtest-vs-live divergence — Sunday 20:00 (after auto-tune)",
    tr: minimizedPs(`npm run divergence >> '${LOG_DIR}\\divergence.log' 2>&1`),
    schedule: `/sc weekly /d SUN /st 20:00`,
  },
  {
    name: "VolumeTurtle_Cleanup",
    description: "Daily DB cleanup — stale RetryQueue + expired PendingOrders at 06:00",
    tr: minimizedPs(`& '${INSTALL_DIR}\\scripts\\cleanup.bat'`),
    schedule: `/sc daily /st 06:00`,
  },
  {
    name: "VolumeTurtle_Watchdog",
    description: "Dev server watchdog — every 5 min 07:55–23:05 weekdays, restarts if down",
    tr: minimizedPs(`& '${INSTALL_DIR}\\scripts\\watchdog.bat'`),
    schedule: `/sc weekly /d MON,TUE,WED,THU,FRI /st 07:55 /ri 5 /du 15:15`,
  },
  {
    name: "VolumeTurtle_WatchdogIndependent",
    description: "Independent watchdog — every 10 min 07:45–23:15 weekdays, runs outside dev server",
    tr: minimizedPs(`npm run watchdog:independent >> '${LOG_DIR}\\watchdog-independent.log' 2>&1`),
    schedule: `/sc weekly /d MON,TUE,WED,THU,FRI /st 07:45 /ri 10 /du 15:30`,
  },
];

function run(task: string, args: string[]): void {
  const result = spawnSync(task, args, {
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) {
    throw result.error;
  }
}

function setup(): void {
  console.log("Setting up agent scheduled tasks...\n");

  // Ensure log directory exists
  try {
    execSync(`mkdir "${LOG_DIR}" 2>nul`, { shell: "cmd.exe" });
  } catch {
    // already exists
  }

  for (const task of TASKS) {
    console.log(`  Creating: ${task.name}`);
    console.log(`    ${task.description}`);
    const scheduleArgs = task.schedule.trim().split(/\s+/);
    run("schtasks", ["/create", "/tn", task.name, "/tr", task.tr, ...scheduleArgs, "/f"]);
    console.log();
  }

  console.log("Verifying tasks:\n");
  for (const task of TASKS) {
    run("schtasks", ["/query", "/tn", task.name]);
    console.log();
  }

  console.log("Done. Agent tasks registered.");
}

function remove(): void {
  console.log("Removing agent scheduled tasks...\n");
  for (const task of TASKS) {
    console.log(`  Removing: ${task.name}`);
    run("schtasks", ["/delete", "/tn", task.name, "/f"]);
  }
  console.log("\nDone.");
}

function status(): void {
  console.log("Agent scheduled task status:\n");
  for (const task of TASKS) {
    console.log(`── ${task.name} ──`);
    run("schtasks", ["/query", "/tn", task.name]);
    console.log();
  }
}

const command = process.argv[2];
switch (command) {
  case "setup":
    setup();
    break;
  case "remove":
    remove();
    break;
  case "status":
    status();
    break;
  default:
    console.log("Usage: schedule-agent.ts <setup|remove|status>");
    process.exit(1);
}
