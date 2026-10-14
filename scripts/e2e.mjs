// Plays one full round against bots and screenshots each phase.
// Usage: node scripts/e2e.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
page.on("console", (m) => m.type() === "error" && console.log("[console.error]", m.text()));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

await page.goto(base);
await page.waitForTimeout(500);
await shot("01-landing");

await page.getByLabel("Name").fill("Benji");
await page.getByRole("button", { name: /create room/i }).click();
await page.waitForSelector(".share-row");
// New rooms start with 3 bots.
await page.getByRole("button", { name: "0:45" }).click();
await page.getByLabel("Chat message").fill("ready to scrap");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await shot("02-lobby");

// A second human joins through the link.
const roomUrl = page.url();
const page2 = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
await page2.goto(roomUrl);
await page2.getByLabel("Name").fill("Friend");
await page2.getByRole("button", { name: /join/i }).click();
await page2.waitForSelector(".share-row");
await page.waitForTimeout(300);
await shot("03-lobby-with-friend");

await page.getByRole("button", { name: /launch/i }).click();
await page.waitForSelector(".draft-board");
await page.waitForTimeout(1000);
await shot("04-draft");

// Build: take offers and click around the core until each one lands.
const board = await page.locator(".draft-board canvas").boundingBox();
const cols = 9; // hauler hull
const PAD = 1; // board margin in cells (see Board.tsx)
const cell = board.width / (cols + PAD * 2);
board.x += PAD * cell;
board.y += PAD * cell;
const spots = [];
for (let y = 0; y < cols; y++) for (let x = 0; x < cols; x++) spots.push([x, y]);
spots.sort((a, b) => Math.hypot(a[0] - 4, a[1] - 4) - Math.hypot(b[0] - 4, b[1] - 4));
let placed = 0;
for (let piece = 0; piece < 8; piece++) {
  const offer = page.locator(".draft-offers .piece-card").first();
  if (!(await offer.count())) break;
  await offer.click();
  await page.waitForTimeout(150);
  for (const [x, y] of spots) {
    if (!(await page.locator(".draft-hand .held").count())) break;
    await page.mouse.move(board.x + (x + 0.5) * cell, board.y + (y + 0.5) * cell);
    await page.mouse.click(board.x + (x + 0.5) * cell, board.y + (y + 0.5) * cell);
    await page.waitForTimeout(60);
  }
  if (!(await page.locator(".draft-hand .held").count())) placed++;
  if (piece === 2) await shot("05-draft-building");
}
console.log("placed", placed);
await page.mouse.move(board.x + board.width / 2, board.y - 40);
await shot("05b-draft-built");

// Wait for the arena.
await page.waitForSelector(".arena-canvas", { timeout: 90000 });
await page.waitForTimeout(3000);
await page.keyboard.down("ArrowUp");
await page.waitForTimeout(1500);
await page.keyboard.up("ArrowUp");
await shot("06-arena");
await page2.screenshot({ path: `${out}/06b-arena-friend.png` });
await page.waitForTimeout(10000);
await shot("07-arena-later");

await page.waitForSelector(".results-title", { timeout: 200000 });
await page.waitForTimeout(500);
await shot("08-results");

await page.getByRole("button", { name: /next round/i }).click();
await page.waitForTimeout(2000);
await shot("09-round-2-draft");

await browser.close();
