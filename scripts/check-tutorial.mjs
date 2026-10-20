// Plays the sheep tutorial in a browser: builds a ship, flies it, then (through the dev-only
// window.__tutorialArena hook) collects every sheep and screenshots the result card.
// Usage: node scripts/check-tutorial.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`${base}/?tutorial=sheep`);
await page.waitForSelector(".draft-board");
// Place one piece next to the cockpit, then launch.
const board = await page.locator(".draft-board canvas").boundingBox();
const cell = board.width / 13;
await page.locator(".draft-offers .piece-card").first().click();
for (const [x, y] of [[5, 7], [4, 7], [6, 7], [5, 8], [3, 6], [7, 6]]) {
  if (!(await page.locator(".draft-offers .piece-card.held").count())) break;
  await page.mouse.click(board.x + (x + 1.5) * cell, board.y + (y + 1.5) * cell);
}
await page.click(".draft-done");
await page.waitForSelector(".arena-canvas");
await page.waitForTimeout(4000);
await page.screenshot({ path: `${out}/tutorial-1-flying.png` });
// Round them all up.
for (let i = 0; i < 40; i++) {
  const left = await page.evaluate(() => {
    const a = window.__tutorialArena;
    const s = a.snapshot().sheep?.[0];
    if (s) {
      const rb = a.ship("me").body.rb;
      rb.setTranslation({ x: s.x, y: s.y }, true);
      rb.setLinvel({ x: 0, y: 0 }, true);
    }
    return a.sheepLeft;
  });
  if (left === 0) break;
  await page.waitForTimeout(120);
}
await page.waitForSelector(".tut-result", { timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: `${out}/tutorial-2-result.png` });
console.log("result:", await page.locator(".tut-result").innerText());
await page.click("text=Lobby");
await page.waitForSelector(".tutorial-link");
console.log("lobby:", await page.locator(".tutorial-link").innerText());
await browser.close();
