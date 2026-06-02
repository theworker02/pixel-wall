import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { config } from "dotenv";

config({ path: resolve("backend", ".env") });

const port = Number(process.env.MODERATION_WEBHOOK_PORT ?? 3010);
const secret = process.env.MODERATION_WEBHOOK_SECRET;
if (!secret) throw new Error("Run npm run setup:moderation before starting the local moderation webhook.");

const safeEqual = (left, right) => {
  if (!left || !right) return false;
  const a = Buffer.from(left), b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
};
const reply = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  if (req.method !== "POST" || req.url !== "/moderate") return reply(res, 404, { error: "Not found." });
  if (!safeEqual(req.headers.authorization, `Bearer ${secret}`)) return reply(res, 401, { error: "Unauthorized." });
  let body = "";
  req.on("data", (chunk) => {
    body += chunk;
    if (body.length > 100_000) req.destroy();
  });
  req.on("end", () => {
    try {
      const payload = JSON.parse(body);
      const pixels = payload?.plot?.pixels;
      if (!payload?.batchId || payload?.plot?.width !== 32 || payload?.plot?.height !== 32 || !Array.isArray(pixels)) {
        return reply(res, 400, { error: "Invalid moderation payload." });
      }
      reply(res, 200, {
        decision: "review",
        score: 0,
        categories: ["local-review"],
        details: "Local adapter queued this artwork for moderator review. Configure a hosted safety classifier in production."
      });
    } catch {
      reply(res, 400, { error: "Malformed JSON." });
    }
  });
}).listen(port, "127.0.0.1", () => {
  console.log(`Local moderation webhook listening on http://127.0.0.1:${port}/moderate`);
});
