import { createHmac, timingSafeEqual } from "node:crypto";
import { db } from "./db.js";
const classifierUrl = process.env.MODERATION_WEBHOOK_URL?.trim();
const classifierSecret = process.env.MODERATION_WEBHOOK_SECRET?.trim();
const hashSecret = process.env.MODERATION_HASH_SECRET ?? "development-only-change-me";
const threshold = Math.min(1, Math.max(0, Number(process.env.MODERATION_BLOCK_THRESHOLD ?? .98)));
const timeoutMs = Math.max(500, Number(process.env.MODERATION_TIMEOUT_MS ?? 4_000));
if (process.env.NODE_ENV === "production") {
    if (!classifierUrl)
        throw new Error("MODERATION_WEBHOOK_URL is required in production.");
    if (!process.env.MODERATION_ADMIN_KEY || process.env.MODERATION_ADMIN_KEY.length < 32 || process.env.MODERATION_ADMIN_KEY.startsWith("replace-with-"))
        throw new Error("MODERATION_ADMIN_KEY must be a unique random value of at least 32 characters in production.");
    if (!process.env.MODERATION_HASH_SECRET || process.env.MODERATION_HASH_SECRET.length < 32 || process.env.MODERATION_HASH_SECRET.startsWith("replace-with-"))
        throw new Error("MODERATION_HASH_SECRET must be a unique random value of at least 32 characters in production.");
}
export const fingerprint = (kind, value) => createHmac("sha256", hashSecret).update(`${kind}:${value.trim().toLowerCase()}`).digest("hex");
export const normalizeNetwork = (value) => value.trim().toLowerCase().replace(/^::ffff:/, "");
export const networkFingerprintValue = (value) => fingerprint("network", normalizeNetwork(value));
export const networkFingerprint = (req) => networkFingerprintValue(req.ip ?? req.socket.remoteAddress ?? "unknown");
export const blacklisted = (kind, valueHash) => Boolean(db.prepare("SELECT 1 FROM blacklist WHERE kind = ? AND value_hash = ?").get(kind, valueHash));
export const networkBanned = (req) => blacklisted("network", networkFingerprint(req));
export const moderationEnabled = () => Boolean(classifierUrl);
export function safeEqual(left, right) {
    if (!left || !right)
        return false;
    const a = Buffer.from(left), b = Buffer.from(right);
    return a.length === b.length && timingSafeEqual(a, b);
}
function insertBlacklist(kind, valueHash, userId, reason) {
    db.prepare("INSERT OR IGNORE INTO blacklist (kind, value_hash, user_id, reason) VALUES (?, ?, ?, ?)").run(kind, valueHash, userId, reason);
}
export function banUser(userId, networkHash, reason) {
    const user = db.prepare("SELECT username, email FROM users WHERE id = ?").get(userId);
    if (!user)
        return [];
    const entry = db.prepare("SELECT origin_x, origin_y, size FROM canvas_entries WHERE user_id = ?").get(userId);
    const removed = entry ? db.prepare(`
    SELECT x, y, NULL AS color FROM pixels
    WHERE user_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ?
  `).all(userId, entry.origin_x, entry.origin_x + entry.size, entry.origin_y, entry.origin_y + entry.size) : [];
    db.exec("BEGIN");
    try {
        db.prepare("UPDATE users SET banned_at = CURRENT_TIMESTAMP, ban_reason = ? WHERE id = ?").run(reason, userId);
        db.prepare("DELETE FROM auth_tokens WHERE user_id = ?").run(userId);
        insertBlacklist("email", fingerprint("email", user.email), userId, reason);
        insertBlacklist("username", fingerprint("username", user.username), userId, reason);
        if (networkHash)
            insertBlacklist("network", networkHash, userId, reason);
        if (entry) {
            db.prepare("DELETE FROM pixels WHERE user_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ?")
                .run(userId, entry.origin_x, entry.origin_x + entry.size, entry.origin_y, entry.origin_y + entry.size);
            db.prepare("UPDATE pixel_history SET hidden_at = CURRENT_TIMESTAMP WHERE user_id = ? AND x >= ? AND x < ? AND y >= ? AND y < ?")
                .run(userId, entry.origin_x, entry.origin_x + entry.size, entry.origin_y, entry.origin_y + entry.size);
        }
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    return removed;
}
export function restoreUserAccess(userId) {
    const user = db.prepare("SELECT id, banned_at FROM users WHERE id = ?").get(userId);
    if (!user?.banned_at)
        return false;
    db.exec("BEGIN");
    try {
        db.prepare("UPDATE users SET banned_at = NULL, ban_reason = NULL WHERE id = ?").run(userId);
        db.prepare("DELETE FROM blacklist WHERE user_id = ?").run(userId);
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    return true;
}
function snapshotPlot(entry) {
    return db.prepare(`
    SELECT x - ? AS x, y - ? AS y, color FROM pixels
    WHERE x >= ? AND x < ? AND y >= ? AND y < ?
  `).all(entry.origin_x, entry.origin_y, entry.origin_x, entry.origin_x + entry.size, entry.origin_y, entry.origin_y + entry.size);
}
async function classifyPlot(input, pixels) {
    if (!classifierUrl)
        return { decision: "review", score: 0, categories: [], details: "No moderation classifier configured." };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(classifierUrl, {
            method: "POST",
            headers: { "content-type": "application/json", ...(classifierSecret ? { authorization: `Bearer ${classifierSecret}` } : {}) },
            body: JSON.stringify({ batchId: input.batchId, plot: { width: input.entry.size, height: input.entry.size, pixels } }),
            signal: controller.signal
        });
        if (!response.ok)
            throw new Error(`Classifier returned HTTP ${response.status}.`);
        const result = await response.json();
        if (!["allow", "review", "block"].includes(String(result.decision)) || !Number.isFinite(result.score))
            throw new Error("Classifier returned an invalid decision.");
        return {
            decision: result.decision,
            score: Math.min(1, Math.max(0, Number(result.score))),
            categories: Array.isArray(result.categories) ? result.categories.map(String).slice(0, 20) : [],
            details: typeof result.details === "string" ? result.details.slice(0, 500) : undefined
        };
    }
    finally {
        clearTimeout(timer);
    }
}
export async function reviewPlot(input, onBlocked) {
    const snapshot = snapshotPlot(input.entry);
    const result = db.prepare("INSERT INTO moderation_events (user_id, batch_id, status, snapshot_json, source, network_hash) VALUES (?, ?, 'pending', ?, ?, ?)").run(input.userId, input.batchId, JSON.stringify(snapshot), classifierUrl ? "webhook" : "unconfigured", input.networkHash);
    const eventId = Number(result.lastInsertRowid);
    try {
        const verdict = await classifyPlot(input, snapshot);
        const shouldBlock = verdict.decision === "block" && verdict.score >= threshold;
        const status = shouldBlock ? "blocked" : verdict.decision === "allow" ? "allowed" : "review";
        db.prepare("UPDATE moderation_events SET status = ?, score = ?, categories_json = ?, details = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(status, verdict.score, JSON.stringify(verdict.categories), verdict.details ?? null, eventId);
        if (shouldBlock)
            onBlocked(banUser(input.userId, input.networkHash, `Automated moderation: ${verdict.categories.join(", ") || "unsafe imagery"}`));
    }
    catch (error) {
        db.prepare("UPDATE moderation_events SET status = 'error', details = ?, resolved_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(error.message.slice(0, 500), eventId);
    }
}
export function moderationEventPlot(eventId) {
    const event = db.prepare(`
    SELECT id, user_id AS userId, batch_id AS batchId, status, score, categories_json AS categories,
      snapshot_json AS pixels, source, details, created_at AS createdAt, resolved_at AS resolvedAt
    FROM moderation_events WHERE id = ?
  `).get(eventId);
    return event ? { ...event, categories: JSON.parse(event.categories), pixels: JSON.parse(event.pixels) } : null;
}
export function moderationSummary() {
    return {
        classifierConfigured: moderationEnabled(),
        blockThreshold: threshold,
        events: db.prepare("SELECT status, COUNT(*) AS count FROM moderation_events GROUP BY status ORDER BY status").all(),
        reviewQueue: db.prepare(`
      SELECT id, user_id AS userId, batch_id AS batchId, status, score, categories_json AS categories, source, details, created_at AS createdAt
      FROM moderation_events WHERE status IN ('review', 'error') ORDER BY id DESC LIMIT 100
    `).all().map((event) => ({ ...event, categories: JSON.parse(String(event.categories)) }))
    };
}
