import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const isWindows = process.platform === "win32";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const children = new Set();
let shuttingDown = false;

function stopTree(child) {
  if (!child.pid || child.exitCode !== null) return;
  if (isWindows) {
    spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
      stdio: "ignore",
      windowsHide: true
    });
  } else {
    child.kill("SIGTERM");
  }
}

function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) stopTree(child);
  process.exitCode = code;
}

function start(label, workspace, script = "dev") {
  const command = isWindows ? process.env.ComSpec ?? "cmd.exe" : "npm";
  const args = isWindows
    ? ["/d", "/s", "/c", `npm.cmd run ${script} -w ${workspace}`]
    : ["run", script, "-w", workspace];
  const child = spawn(command, args, {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`[${label}] Failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`[${label}] stopped${signal ? ` (${signal})` : ` with code ${code ?? 0}`}. Closing development servers.`);
    shutdown(code ?? 1);
  });
}

function startNode(label, script) {
  const child = spawn(process.execPath, [script], {
    cwd: root,
    stdio: "inherit",
    windowsHide: true
  });
  children.add(child);
  child.on("error", (error) => {
    console.error(`[${label}] Failed to start: ${error.message}`);
    shutdown(1);
  });
  child.on("exit", (code, signal) => {
    children.delete(child);
    if (shuttingDown) return;
    console.error(`[${label}] stopped${signal ? ` (${signal})` : ` with code ${code ?? 0}`}. Closing development servers.`);
    shutdown(code ?? 1);
  });
}

process.once("SIGINT", () => shutdown(0));
process.once("SIGTERM", () => shutdown(0));
process.once("SIGHUP", () => shutdown(0));
process.once("exit", () => {
  for (const child of children) stopTree(child);
});

startNode("moderation", resolve(root, "scripts", "moderation-webhook.mjs"));
start("backend", "backend");
start("frontend", "frontend", "dev:vite");
