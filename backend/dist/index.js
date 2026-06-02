import "dotenv/config";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import bcrypt from "bcryptjs";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { Server } from "socket.io";
import { appealsQueue, createAppeal, evaluateAppeal, publicAppealStatus, resolveAppeal } from "./appeals.js";
import { auth, createToken, deleteToken, requireAuth } from "./auth.js";
import { db } from "./db.js";
import { banUser, blacklisted, fingerprint, moderationEventPlot, moderationSummary, networkBanned, networkFingerprint, networkFingerprintValue, restoreUserAccess, reviewPlot, safeEqual } from "./moderation.js";
import { rateLimit } from "./security.js";
const app = express();
const server = createServer(app);
const clientUrl = process.env.CLIENT_URL ?? "http://localhost:5173";
const io = new Server(server, { cors: { origin: clientUrl } });
const CANVAS_SIZE = 8192;
const ENTRY_SIZE = 32;
const COOLDOWN_MS = 650;
const DUMMY_PASSWORD_HASH = "$2b$12$1DVqnOWEJMnv0dL0vTm8p.Sx9W8adQpRLTYp0xTEX3TSQCWMMmNhW";
const drawTimes = new Map();
const generalLimit = rateLimit({ windowMs: 60_000, max: 240, message: "Too many requests. Take a short pause." });
const authLimit = rateLimit({ windowMs: 10 * 60_000, max: 20, message: "Too many sign-in attempts. Try again later." });
const appealLimit = rateLimit({ windowMs: 60 * 60_000, max: 5, message: "Too many appeal attempts. Try again later." });
const moderatorToken = (authorization) => authorization?.replace(/^Bearer /, "");
const isModeratorRequest = (req) => req.path.startsWith("/api/moderation/") && safeEqual(moderatorToken(req.headers.authorization), process.env.MODERATION_ADMIN_KEY);
const isAppealRequest = (req) => req.path === "/api/appeals" || /^\/api\/appeals\/\d+$/.test(req.path);
if (process.env.TRUST_PROXY === "true")
    app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cors({ origin: clientUrl, methods: ["GET", "POST"], allowedHeaders: ["Content-Type", "Authorization", "X-Appeal-Receipt"] }));
app.use(express.json({ limit: "100kb" }));
app.use((req, res, next) => {
    if (networkBanned(req) && !isModeratorRequest(req) && !isAppealRequest(req))
        return res.status(403).json({ error: "Access denied." });
    next();
});
app.use(auth);
app.use(generalLimit);
const validColor = (color) => typeof color === "string" && /^#[0-9a-f]{6}$/i.test(color);
const validCoord = (value) => Number.isInteger(value) && Number(value) >= 0 && Number(value) < CANVAS_SIZE;
const publicUser = (user) => ({ ...user, canvasSize: CANVAS_SIZE });
const validEmail = (email) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 254;
const entryFor = (x, y) => ({ origin_x: Math.floor(x / ENTRY_SIZE) * ENTRY_SIZE, origin_y: Math.floor(y / ENTRY_SIZE) * ENTRY_SIZE, size: ENTRY_SIZE });
const publicEntry = (entry) => entry ? { originX: entry.origin_x, originY: entry.origin_y, size: entry.size } : null;
const withinEntry = (point, entry) => point.x >= entry.origin_x && point.x < entry.origin_x + entry.size && point.y >= entry.origin_y && point.y < entry.origin_y + entry.size;
app.post("/api/auth/register", authLimit, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const username = String(body.username ?? "").trim();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    if (!/^[a-z0-9_]{3,20}$/i.test(username))
        return res.status(400).json({ error: "Username must use 3-20 letters, numbers, or underscores." });
    if (!validEmail(email))
        return res.status(400).json({ error: "Enter a valid email address." });
    if (password.length < 8)
        return res.status(400).json({ error: "Password must be at least 8 characters." });
    if (password.length > 128)
        return res.status(400).json({ error: "Password must be 128 characters or fewer." });
    if (blacklisted("email", fingerprint("email", email)) || blacklisted("username", fingerprint("username", username)))
        return res.status(403).json({ error: "Access denied." });
    try {
        const result = db.prepare("INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)").run(username, email, await bcrypt.hash(password, 12));
        const user = db.prepare("SELECT id, username, created_at, last_active FROM users WHERE id = ?").get(result.lastInsertRowid);
        res.status(201).json({ token: createToken(user.id), user: publicUser(user) });
    }
    catch {
        res.status(409).json({ error: "That username or email is already in use." });
    }
});
app.post("/api/auth/login", authLimit, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const identifier = String(body.identifier ?? body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const row = db.prepare("SELECT * FROM users WHERE email = ? OR username = ?").get(identifier, identifier);
    const passwordMatches = password.length <= 128 && await bcrypt.compare(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !passwordMatches)
        return res.status(401).json({ error: "Incorrect email, username, or password." });
    if (row.banned_at || blacklisted("email", fingerprint("email", row.email)) || blacklisted("username", fingerprint("username", row.username)))
        return res.status(403).json({ error: "Access denied." });
    const { password_hash: _, email: __, ...user } = row;
    res.json({ token: createToken(user.id), user: publicUser(user) });
});
app.get("/api/auth/me", (req, res) => res.json({ user: req.user ? publicUser(req.user) : null }));
app.post("/api/auth/logout", (req, res) => {
    deleteToken(req.headers.authorization?.replace(/^Bearer /, ""));
    res.json({ ok: true });
});
app.post("/api/appeals", appealLimit, async (req, res) => {
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const identifier = String(body.identifier ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");
    const statement = String(body.statement ?? "").trim();
    if (statement.length < 30 || statement.length > 1_500)
        return res.status(400).json({ error: "Appeal statement must use 30-1500 characters." });
    const row = db.prepare("SELECT id, password_hash, banned_at FROM users WHERE email = ? OR username = ?").get(identifier, identifier);
    const passwordMatches = password.length <= 128 && await bcrypt.compare(password, row?.password_hash ?? DUMMY_PASSWORD_HASH);
    if (!row || !passwordMatches || !row.banned_at)
        return res.status(401).json({ error: "Unable to verify a banned account with those credentials." });
    const appeal = createAppeal(row.id, statement, networkFingerprint(req));
    if ("error" in appeal)
        return res.status(409).json({ error: appeal.error });
    void evaluateAppeal(appeal.id);
    res.status(202).json({ appeal: { id: appeal.id, receipt: appeal.receipt, status: "pending" } });
});
app.get("/api/appeals/:id", appealLimit, (req, res) => {
    const receipt = String(req.headers["x-appeal-receipt"] ?? "");
    if (!receipt)
        return res.status(400).json({ error: "Appeal receipt required." });
    const appeal = publicAppealStatus(String(req.params.id), receipt);
    if (!appeal)
        return res.status(404).json({ error: "Appeal not found." });
    res.json({ appeal });
});
app.get("/api/canvas", (_req, res) => {
    const pixels = db.prepare("SELECT p.x, p.y, p.color, p.user_id AS userId, p.created_at AS createdAt FROM pixels p JOIN users u ON u.id = p.user_id WHERE u.banned_at IS NULL").all();
    const recent = db.prepare(`
    SELECT h.batch_id AS batchId, h.user_id AS userId, u.username, COUNT(*) AS pixelCount,
      MIN(h.x) AS minX, MIN(h.y) AS minY, MAX(h.x) AS maxX, MAX(h.y) AS maxY,
      MAX(h.created_at) AS createdAt,
      json_group_array(json_object('x', h.x, 'y', h.y)) AS pixels,
      (SELECT new_color FROM pixel_history WHERE batch_id = h.batch_id AND operation = 'paint' ORDER BY id DESC LIMIT 1) AS color
    FROM pixel_history h JOIN users u ON u.id = h.user_id
    WHERE h.operation = 'paint' AND h.hidden_at IS NULL AND u.banned_at IS NULL
    GROUP BY h.batch_id, h.user_id, u.username
    ORDER BY MAX(h.id) DESC LIMIT 12
  `).all().map((batch) => ({ ...batch, pixels: JSON.parse(batch.pixels) }));
    res.json({ width: CANVAS_SIZE, height: CANVAS_SIZE, pixels, recent });
});
app.get("/api/canvas/entry", requireAuth, (req, res) => {
    const entry = db.prepare("SELECT origin_x, origin_y, size FROM canvas_entries WHERE user_id = ?").get(req.user.id);
    res.json({ entry: publicEntry(entry), maxEntrySize: ENTRY_SIZE });
});
app.post("/api/canvas/pixels", requireAuth, (req, res) => {
    const user = req.user;
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const points = body.pixels;
    if (!Array.isArray(points) || points.length < 1)
        return res.status(400).json({ error: "Send at least one pixel." });
    const age = Date.now() - Date.parse(user.created_at);
    const limit = age < 86_400_000 ? 16 : 64;
    if (points.length > limit)
        return res.status(400).json({ error: `Your current batch limit is ${limit} pixels.` });
    if (points.some((p) => !p || !validCoord(p.x) || !validCoord(p.y) || (p.erase !== true && !validColor(p.color))))
        return res.status(400).json({ error: "Invalid pixel coordinates or color." });
    const unique = [...new Map(points.map((p) => [`${p.x}:${p.y}`, p])).values()];
    const savedEntry = db.prepare("SELECT origin_x, origin_y, size FROM canvas_entries WHERE user_id = ?").get(user.id);
    if (!savedEntry && unique.every((point) => point.erase === true))
        return res.status(400).json({ error: "Draw at least one pixel to claim your entry before using the eraser." });
    const entry = savedEntry ?? entryFor(unique[0].x, unique[0].y);
    if (unique.some((point) => !withinEntry(point, entry)))
        return res.status(400).json({ error: savedEntry ? "Your account already has one entry. Keep drawing inside your 32 x 32 plot." : "Your first entry must fit inside one 32 x 32 plot." });
    const now = Date.now();
    const wait = COOLDOWN_MS - (now - (drawTimes.get(user.id) ?? 0));
    if (wait > 0)
        return res.status(429).json({ error: "Cooldown active.", retryAfter: wait });
    drawTimes.set(user.id, now);
    const batchId = randomUUID();
    const read = db.prepare("SELECT color, user_id FROM pixels WHERE x = ? AND y = ?");
    const write = db.prepare(`
    INSERT INTO pixels (user_id, x, y, color) VALUES (?, ?, ?, ?)
    ON CONFLICT(x, y) DO UPDATE SET user_id=excluded.user_id, color=excluded.color, created_at=CURRENT_TIMESTAMP
  `);
    const history = db.prepare("INSERT INTO pixel_history (user_id, batch_id, x, y, previous_color, new_color, operation, previous_user_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
    db.exec("BEGIN");
    try {
        if (!savedEntry)
            db.prepare("INSERT INTO canvas_entries (user_id, origin_x, origin_y, size) VALUES (?, ?, ?, ?)").run(user.id, entry.origin_x, entry.origin_y, entry.size);
        for (const p of unique) {
            const previous = read.get(p.x, p.y);
            if (p.erase === true) {
                if (!previous)
                    continue;
                db.prepare("DELETE FROM pixels WHERE x = ? AND y = ?").run(p.x, p.y);
                history.run(user.id, batchId, p.x, p.y, previous.color, previous.color, "erase", previous.user_id);
            }
            else {
                write.run(user.id, p.x, p.y, p.color);
                history.run(user.id, batchId, p.x, p.y, previous?.color ?? null, p.color, "paint", previous?.user_id ?? null);
            }
        }
        db.prepare("UPDATE canvas_entries SET updated_at = CURRENT_TIMESTAMP WHERE user_id = ?").run(user.id);
        db.prepare("UPDATE users SET last_active = CURRENT_TIMESTAMP WHERE id = ?").run(user.id);
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    const placed = unique.map((p) => ({ x: p.x, y: p.y, color: p.erase === true ? null : p.color, userId: user.id, username: user.username, batchId }));
    io.emit("pixels:placed", placed);
    void reviewPlot({ userId: user.id, batchId, networkHash: networkFingerprint(req), entry }, (removed) => {
        if (!removed.length)
            return;
        io.emit("pixels:undone", removed);
        io.emit("moderation:plot-removed", { userId: user.id });
    });
    res.status(201).json({ batchId, pixels: placed, cooldownMs: COOLDOWN_MS, entry: publicEntry(entry) });
});
app.post("/api/canvas/undo", requireAuth, (req, res) => {
    const user = req.user;
    const latest = db.prepare("SELECT batch_id FROM pixel_history WHERE user_id = ? AND hidden_at IS NULL ORDER BY id DESC LIMIT 1").get(user.id);
    if (!latest)
        return res.status(404).json({ error: "Nothing to undo yet." });
    const rows = db.prepare("SELECT * FROM pixel_history WHERE user_id = ? AND batch_id = ? ORDER BY id DESC").all(user.id, latest.batch_id);
    const current = db.prepare("SELECT color, user_id FROM pixels WHERE x = ? AND y = ?");
    const updates = [];
    db.exec("BEGIN");
    try {
        for (const row of rows) {
            const pixel = current.get(row.x, row.y);
            if (row.operation === "erase") {
                if (pixel || !row.previous_color)
                    continue;
                db.prepare("INSERT INTO pixels (user_id, x, y, color) VALUES (?, ?, ?, ?)").run(row.previous_user_id ?? user.id, row.x, row.y, row.previous_color);
            }
            else {
                if (!pixel || pixel.user_id !== user.id || pixel.color !== row.new_color)
                    continue;
                if (row.previous_color)
                    db.prepare("UPDATE pixels SET color = ?, user_id = ?, created_at = CURRENT_TIMESTAMP WHERE x = ? AND y = ?").run(row.previous_color, row.previous_user_id ?? user.id, row.x, row.y);
                else
                    db.prepare("DELETE FROM pixels WHERE x = ? AND y = ?").run(row.x, row.y);
            }
            updates.push({ x: row.x, y: row.y, color: row.previous_color });
        }
        db.prepare("DELETE FROM pixel_history WHERE user_id = ? AND batch_id = ?").run(user.id, latest.batch_id);
        db.exec("COMMIT");
    }
    catch (error) {
        db.exec("ROLLBACK");
        throw error;
    }
    io.emit("pixels:undone", updates);
    res.json({ pixels: updates });
});
const leaderboardSelect = `
  SELECT u.id, u.username, COUNT(h.id) AS pixelsPlaced,
    COALESCE((SELECT new_color FROM pixel_history WHERE user_id=u.id AND hidden_at IS NULL GROUP BY new_color ORDER BY COUNT(*) DESC LIMIT 1), '#71717a') AS favoriteColor,
    u.last_active AS lastActive, u.created_at AS joinDate
  FROM users u LEFT JOIN pixel_history h ON h.user_id=u.id AND h.hidden_at IS NULL
  WHERE u.banned_at IS NULL`;
const leaderboard = (where = "", order = "pixelsPlaced DESC") => db.prepare(`${leaderboardSelect} ${where} GROUP BY u.id ORDER BY ${order} LIMIT 100`).all();
const longestStreak = (userId) => {
    const days = db.prepare("SELECT DISTINCT date(created_at) AS day FROM pixel_history WHERE user_id = ? AND hidden_at IS NULL ORDER BY day").all(userId);
    let longest = 0, current = 0, previous = 0;
    for (const { day } of days) {
        const stamp = Date.parse(`${day}T00:00:00Z`);
        current = previous && stamp - previous === 86_400_000 ? current + 1 : 1;
        longest = Math.max(longest, current);
        previous = stamp;
    }
    return longest;
};
app.get("/api/leaderboard/all-time", (_req, res) => res.json({ users: leaderboard() }));
app.get("/api/leaderboard/weekly", (_req, res) => res.json({ users: leaderboard("AND h.created_at >= datetime('now', '-7 days')") }));
app.get("/api/leaderboard/newest", (_req, res) => res.json({ users: leaderboard("", "u.created_at DESC") }));
app.get("/api/leaderboard/colors", (_req, res) => res.json({ users: db.prepare(`${leaderboardSelect} GROUP BY u.id ORDER BY COUNT(DISTINCT h.new_color) DESC LIMIT 100`).all() }));
app.get("/api/leaderboard/streaks", (_req, res) => {
    const users = leaderboard().map((user) => ({ ...user, streak: longestStreak(user.id) })).sort((a, b) => b.streak - a.streak);
    res.json({ users });
});
app.get("/api/users/:id/profile", (req, res) => {
    const profile = db.prepare(`
    SELECT u.id, u.username, u.created_at AS joinDate, u.last_active AS lastActive, COUNT(h.id) AS totalPixels,
      SUM(CASE WHEN h.created_at >= datetime('now','-7 days') THEN 1 ELSE 0 END) AS weeklyPixels,
      MIN(h.created_at) AS firstPixel,
      COALESCE((SELECT new_color FROM pixel_history WHERE user_id=u.id AND hidden_at IS NULL GROUP BY new_color ORDER BY COUNT(*) DESC LIMIT 1), '#71717a') AS favoriteColor,
      COUNT(DISTINCT date(h.created_at)) AS drawingStreak
    FROM users u LEFT JOIN pixel_history h ON h.user_id=u.id AND h.hidden_at IS NULL WHERE u.id=? AND u.banned_at IS NULL GROUP BY u.id
  `).get(req.params.id);
    if (!profile)
        return res.status(404).json({ error: "User not found." });
    const preview = db.prepare("SELECT x, y, new_color AS color FROM pixel_history WHERE user_id=? AND hidden_at IS NULL ORDER BY id DESC LIMIT 180").all(req.params.id);
    res.json({ profile: { ...profile, drawingStreak: longestStreak(Number(req.params.id)) }, preview });
});
app.get("/api/users/:id/activity", (req, res) => res.json({ activity: db.prepare("SELECT x, y, new_color AS color, created_at AS createdAt FROM pixel_history WHERE user_id=? AND hidden_at IS NULL ORDER BY id DESC LIMIT 30").all(req.params.id) }));
app.get("/api/stats/colors", (_req, res) => res.json({ colors: db.prepare("SELECT p.color, COUNT(*) AS count FROM pixels p JOIN users u ON u.id = p.user_id WHERE u.banned_at IS NULL GROUP BY p.color ORDER BY count DESC LIMIT 8").all() }));
app.get("/api/stats/heatmap", (_req, res) => res.json({ cells: db.prepare("SELECT x/32 AS x, y/32 AS y, COUNT(*) AS count FROM pixel_history WHERE hidden_at IS NULL GROUP BY x/32, y/32 ORDER BY count DESC LIMIT 500").all() }));
app.get("/api/replay", (_req, res) => res.json({ pixels: db.prepare("SELECT x, y, CASE WHEN operation = 'erase' THEN NULL ELSE new_color END AS color, created_at AS createdAt FROM pixel_history WHERE hidden_at IS NULL ORDER BY id ASC LIMIT 10000").all() }));
const requireModerator = (req, res, next) => {
    if (!safeEqual(moderatorToken(req.headers.authorization), process.env.MODERATION_ADMIN_KEY))
        return res.status(401).json({ error: "Moderator authorization required." });
    next();
};
app.get("/api/moderation/monitor", requireModerator, (_req, res) => res.json(moderationSummary()));
app.get("/api/moderation/appeals", requireModerator, (_req, res) => res.json({ appeals: appealsQueue() }));
app.get("/api/moderation/events/:id/plot", requireModerator, (req, res) => {
    const event = moderationEventPlot(String(req.params.id));
    if (!event)
        return res.status(404).json({ error: "Moderation event not found." });
    res.json({ event });
});
app.post("/api/moderation/events/:id/ban", requireModerator, (req, res) => {
    const event = db.prepare("SELECT id, user_id AS userId, network_hash AS networkHash FROM moderation_events WHERE id = ?").get(String(req.params.id));
    if (!event)
        return res.status(404).json({ error: "Moderation event not found." });
    const removed = banUser(event.userId, event.networkHash, "Moderator-confirmed unsafe imagery");
    db.prepare("UPDATE moderation_events SET status = 'blocked', resolved_at = CURRENT_TIMESTAMP WHERE id = ?").run(event.id);
    io.emit("pixels:undone", removed);
    io.emit("moderation:plot-removed", { userId: event.userId });
    res.json({ ok: true, removedPixels: removed.length });
});
app.post("/api/moderation/events/:id/allow", requireModerator, (req, res) => {
    const result = db.prepare("UPDATE moderation_events SET status = 'allowed', resolved_at = CURRENT_TIMESTAMP WHERE id = ? AND status IN ('review', 'error')").run(String(req.params.id));
    if (!result.changes)
        return res.status(404).json({ error: "Reviewable moderation event not found." });
    res.json({ ok: true });
});
app.post("/api/moderation/users/:id/restore", requireModerator, (req, res) => {
    if (!restoreUserAccess(Number(req.params.id)))
        return res.status(404).json({ error: "Banned user not found." });
    res.json({ ok: true, message: "Access restored. Removed artwork stays erased and the user must sign in again." });
});
app.post("/api/moderation/appeals/:id/restore", requireModerator, (req, res) => {
    const appeal = db.prepare("SELECT user_id AS userId FROM moderation_appeals WHERE id = ? AND status IN ('recommended_restore', 'recommended_deny', 'review', 'error')").get(String(req.params.id));
    if (!appeal || !restoreUserAccess(appeal.userId) || !resolveAppeal(String(req.params.id), "restored"))
        return res.status(404).json({ error: "Reviewable appeal not found." });
    res.json({ ok: true, message: "Appeal approved. Access restored; removed artwork stays erased." });
});
app.post("/api/moderation/appeals/:id/deny", requireModerator, (req, res) => {
    if (!resolveAppeal(String(req.params.id), "denied"))
        return res.status(404).json({ error: "Reviewable appeal not found." });
    res.json({ ok: true });
});
app.use((err, _req, res, _next) => {
    const error = err;
    const status = Number(error.status);
    console.error(`[api-error] ${Number.isFinite(status) ? status : 500} ${error.message ?? "Unknown server error"}`);
    if (status === 400 || status === 413)
        return res.status(status).json({ error: status === 413 ? "Request body is too large." : "Malformed JSON request body." });
    res.status(500).json({ error: "The wall hit an unexpected error." });
});
io.use((socket, next) => {
    if (blacklisted("network", networkFingerprintValue(socket.handshake.address)))
        return next(new Error("Access denied."));
    next();
});
io.on("connection", (socket) => socket.emit("wall:connected", { canvasSize: CANVAS_SIZE }));
const port = Number(process.env.PORT ?? 3001);
server.listen(port, () => console.log(`Pixel Wall API listening on http://localhost:${port}`));
