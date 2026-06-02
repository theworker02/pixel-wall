import { createHash, randomBytes } from "node:crypto";
import { db } from "./db.js";
const hash = (token) => createHash("sha256").update(token).digest("hex");
export function createToken(userId) {
    const token = randomBytes(32).toString("hex");
    const days = Number(process.env.SESSION_DAYS ?? 30);
    db.prepare("INSERT INTO auth_tokens (user_id, token_hash, expires_at) VALUES (?, ?, datetime('now', ?))")
        .run(userId, hash(token), `+${days} days`);
    return token;
}
export function auth(req, _res, next) {
    const token = req.headers.authorization?.replace(/^Bearer /, "");
    if (token) {
        req.user = db.prepare(`
      SELECT users.id, users.username, users.created_at, users.last_active
      FROM auth_tokens JOIN users ON users.id = auth_tokens.user_id
      WHERE auth_tokens.token_hash = ? AND auth_tokens.expires_at > CURRENT_TIMESTAMP AND users.banned_at IS NULL
    `).get(hash(token));
    }
    next();
}
export function requireAuth(req, res, next) {
    if (!req.user)
        return res.status(401).json({ error: "Log in to draw on the wall." });
    next();
}
export function deleteToken(token) {
    if (token)
        db.prepare("DELETE FROM auth_tokens WHERE token_hash = ?").run(hash(token));
}
