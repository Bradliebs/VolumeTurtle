import { execSync } from "child_process";
import path from "path";

const INSTALL_DIR = path.resolve(__dirname, "..");
const LOG_DIR = path.join(process.env["USERPROFILE"] ?? "C:\\Users\\Default", "VolumeTurtle", "logs");

const TASKS = [
  {
    name: "VolumeTurtle_Agent",
    description: "Agent cycle — hourly 08:00–21:00 weekdays",
    tr: `cmd /c cd /d "${INSTALL_DIR}" && npx tsx src/agent/runner.ts >> "${LOG_DIR}\\agent.log" 2>&1`,
    schedule: `/sc weekly /d MON,TUE,WED,THU,FRI /st 08:00 /ri 60 /du 13:00`,
  },
  {
    name: "VolumeTurtle_AgentListen",
    description: "Telegram listener — every 2 min 08:00–21:00 weekdays",
    tr: `cmd /c cd /d "${INSTALL_DIR}" && npx tsx src/agent/telegram-listener.ts >> "${LOG_DIR}\\agent-listen.log" 2>&1`,
    schedule: `/sc weekly /d MON,TUE,WED,THU,FRI /st 08:00 /ri 2 /du 13:00`,
  },
  {
    name: "VolumeTurtle_AgentSnapshot",
    description: "Sunday maintenance — universe snapshot at 18:00",
    tr: `cmd /c cd /d "${INSTALL_DIR}" && npx tsx src/agent/runner-sunday.ts >> "${LOG_DIR}\\agent-sunday.log" 2>&1`,
    schedule: `/sc weekly /d SUN /st 18:00`,
  },
  {
    name: "VolumeTurtle_AgentAutoTune",
    description: "Sunday maintenance — auto-tune at 19:00",
    tr: `cmd /c cd /d "${INSTALL_DIR}" && npx tsx src/agent/runner-sunday.ts >> "${LOG_DIR}\\agent-sunday.log" 2>&1`,
    schedule: `/sc weekly /d SUN /st 19:00`,
  },
  {
    name: "VolumeTurtle_AgentFriday",
    description: "Friday weekly debrief — 21:30 after US close",
    tr: `cmd /c cd /d "${INSTALL_DIR}" && npx tsx src/agent/runner-friday.ts >> "${LOG_DIR}\\agent-friday.log" 2>&1`,
    schedule: `/sc weekly /d FRI /st 21:30`,
  },
];

function run(cmd: string): void {
  try {
    execSync(cmd, { stdio: "inherit" });
  } catch {
    // schtasks returns non-zero on some queries when task doesn't exist
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
    run(
      `schtasks /create /tn "${task.name}" /tr "${task.tr}" ${task.schedule} /f`
    );
    console.log();
  }

  console.log("Verifying tasks:\n");
  for (const task of TASKS) {
    run(`schtasks /query /tn "${task.name}"`);
    console.log();
  }

  console.log("Done. Agent tasks registered.");
}

function remove(): void {
  console.log("Removing agent scheduled tasks...\n");
  for (const task of TASKS) {
    console.log(`  Removing: ${task.name}`);
    run(`schtasks /delete /tn "${task.name}" /f`);
  }
  console.log("\nDone.");
}

function status(): void {
  console.log("Agent scheduled task status:\n");
  for (const task of TASKS) {
    console.log(`── ${task.name} ──`);
    run(`schtasks /query /tn "${task.name}"`);
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
