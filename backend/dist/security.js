export function rateLimit({ windowMs, max, message }) {
    const hits = new Map();
    let nextSweep = Date.now() + windowMs;
    return (req, res, next) => {
        const now = Date.now();
        if (now >= nextSweep) {
            for (const [key, hit] of hits)
                if (hit.resetAt <= now)
                    hits.delete(key);
            nextSweep = now + windowMs;
        }
        const key = req.ip ?? req.socket.remoteAddress ?? "unknown";
        const hit = hits.get(key);
        if (!hit || hit.resetAt <= now) {
            hits.set(key, { count: 1, resetAt: now + windowMs });
            return next();
        }
        hit.count++;
        if (hit.count > max) {
            res.setHeader("Retry-After", String(Math.max(1, Math.ceil((hit.resetAt - now) / 1000))));
            return res.status(429).json({ error: message });
        }
        next();
    };
}
