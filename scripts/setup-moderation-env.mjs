import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envPath = resolve(root, "backend", ".env");
const defaults = new Map([
  ["PORT", "3001"],
  ["CLIENT_URL", "http://localhost:5173"],
  ["DATABASE_PATH", "./data/pixel-wall.db"],
  ["SESSION_DAYS", "30"],
  ["TRUST_PROXY", "false"],
  ["MODERATION_WEBHOOK_URL", "http://127.0.0.1:3010/moderate"],
  ["MODERATION_WEBHOOK_SECRET", randomBytes(48).toString("hex")],
  ["MODERATION_BLOCK_THRESHOLD", "0.98"],
  ["MODERATION_TIMEOUT_MS", "4000"],
  ["MODERATION_HASH_SECRET", randomBytes(48).toString("hex")],
  ["MODERATION_ADMIN_KEY", randomBytes(48).toString("hex")],
  ["GEMINI_API_KEY", ""],
  ["GEMINI_APPEAL_MODEL", "gemini-2.5-flash"],
  ["GEMINI_APPEAL_TIMEOUT_MS", "8000"]
]);

if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const separator = line.indexOf("=");
    if (separator <= 0) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value && !value.startsWith("replace-with-")) defaults.set(key, value);
  }
}

writeFileSync(envPath, `${[...defaults].map(([key, value]) => `${key}=${value}`).join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
console.log("Moderation environment is configured in backend/.env. Secret values were not printed.");
