import "dotenv/config";
import bcrypt from "bcryptjs";
import { db } from "./db.js";

const accounts = ["neonmoss", "orbitline", "staticbloom", "tinyarchitect"];
for (const username of accounts) {
  db.prepare("INSERT OR IGNORE INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, datetime('now', '-10 days'))")
    .run(username, `${username}@pixelwall.local`, await bcrypt.hash("pixelwall", 10));
}

const users = db.prepare(`SELECT id FROM users WHERE username IN ('neonmoss', 'orbitline', 'staticbloom', 'tinyarchitect') ORDER BY id`).all() as Array<{ id: number }>;
db.exec(`
  DELETE FROM pixels
  WHERE EXISTS (
    SELECT 1 FROM pixel_history h
    WHERE h.batch_id LIKE 'seed-%'
      AND h.x = pixels.x AND h.y = pixels.y
      AND h.user_id = pixels.user_id AND h.new_color = pixels.color
  );
  DELETE FROM pixel_history WHERE batch_id LIKE 'seed-%';
`);

const legend: Record<string, string> = {
  C: "#22d3ee", P: "#a78bfa", M: "#f472b6", Y: "#facc15",
  G: "#4ade80", R: "#fb7185", O: "#fb923c", D: "#111827", W: "#ffffff",
  B: "#2563eb", N: "#0284c7", T: "#78350f", L: "#f5d0a9"
};
const sprites = [
  { plotX: 960, plotY: 896, x: 964, y: 900, rows: [
    "....Y...............Y...",
    "........................",
    "...........CC...........",
    "..........CWWC..........",
    ".........CWWWWC.........",
    ".........CWWWWC.........",
    "........CWWDDWWC........",
    "........CWWDDWWC........",
    "........CWWWWWWC........",
    ".......CWWCCCCWWC.......",
    ".......CWWCCCCWWC.......",
    ".......CWWCCCCWWC.......",
    "......CCWWCCCCWWCC......",
    "......C.WWCCCCWW.C......",
    "........WWCCCCWW........",
    "........WWCCCCWW........",
    ".......RWWCCCCWWR.......",
    "......RR.WWCCWW.RR......",
    ".....RR..WWCCWW..RR.....",
    ".........OCOC...........",
    ".........OYYO...........",
    "........OYYYYO..........",
    ".......Y..YY..Y.........",
    "..Y..................Y.."
  ] },
  { plotX: 1024, plotY: 896, x: 1028, y: 900, rows: [
    ".....................Y..",
    ".........RRRRR..........",
    "......RRRRRRRRRRR.......",
    "....RRRRRRRRRRRRRRR.....",
    "...RRRRWWRRRRWWRRRR.....",
    "..RRRRRWWRRRRWWRRRRR....",
    "..RRRRRRRRRRRRRRRRRR....",
    ".RRRRRWRRRRRRRRWRRRRR...",
    ".RRRRRRWWWWWWWWRRRRRR...",
    "..RRRRRRRRRRRRRRRRRR....",
    "...RRRRRRRRRRRRRRRR.....",
    ".....RRRRRRRRRRRR.......",
    ".......TTTTTTTT.........",
    "......TLLLLLLLLT........",
    ".....TLLLLLLLLLLT.......",
    ".....TLLCCLLCCLLT.......",
    ".....TLLCCLLCCLLT.......",
    ".....TLLLLLLLLLLT.......",
    ".....TLLLLTTLLLLT.......",
    ".....TLLLLTTLLLLT.......",
    ".....TTTTTTTTTTTT.......",
    "......GGGGGGGGGG........",
    ".....GGG.GGGG.GGG.......",
    "....GG...........GG....."
  ] },
  { plotX: 1088, plotY: 896, x: 1092, y: 900, rows: [
    "...Y....................",
    "....................Y...",
    "...........WW...........",
    "..........WYYW..........",
    ".........WYYYYW.........",
    ".........WWWWWW.........",
    "..........WDDW..........",
    "..........WDDW..........",
    ".........WWDDWW.........",
    ".........WCDDCW.........",
    ".........WCDDCW.........",
    "........WWDDDDWW........",
    "........WCDDDDCT........",
    "........WCDDDDCT........",
    ".......WWDDDDDDWW.......",
    ".......WWWWWWWWWW.......",
    ".........TTTTTT.........",
    "......NNNNNNNNNNNN......",
    "....NNNNNNNNNNNNNNNN....",
    "..BBBBBBBBBBBBBBBBBBBB..",
    "BBBBBBBBBBBBBBBBBBBBBBBB",
    "..BBBBBBBBBBBBBBBBBBBB..",
    ".....NNNNNNNNNNNNNN.....",
    ".....................Y.."
  ] }
];
const writePixel = db.prepare(`
  INSERT INTO pixels (user_id, x, y, color) VALUES (?, ?, ?, ?)
  ON CONFLICT(x, y) DO UPDATE SET user_id=excluded.user_id, color=excluded.color, created_at=CURRENT_TIMESTAMP
`);
const writeHistory = db.prepare("INSERT INTO pixel_history (user_id, batch_id, x, y, previous_color, new_color, created_at) VALUES (?, ?, ?, ?, NULL, ?, datetime('now', ?))");
const writeEntry = db.prepare("INSERT OR IGNORE INTO canvas_entries (user_id, origin_x, origin_y, size) VALUES (?, ?, ?, 32)");

let pixelIndex = 0;
db.exec("BEGIN");
try {
  sprites.forEach((sprite, spriteIndex) => {
    const userId = users[spriteIndex].id;
    writeEntry.run(userId, sprite.plotX, sprite.plotY);
    sprite.rows.forEach((row, rowIndex) => {
      [...row].forEach((cell, columnIndex) => {
        const color = legend[cell];
        if (!color) return;
        const x = sprite.x + columnIndex;
        const y = sprite.y + rowIndex;
        writePixel.run(userId, x, y, color);
        writeHistory.run(userId, `seed-art-${spriteIndex}`, x, y, color, `-${pixelIndex % 9} days`);
        pixelIndex++;
      });
    });
  });
  db.exec("COMMIT");
} catch (error) {
  db.exec("ROLLBACK");
  throw error;
}

console.log(`Development wall seeded with ${pixelIndex} pixel-art cells. Demo password: pixelwall`);
