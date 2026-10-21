// Tutorial build: fill the ship until nothing fits, then check Done still launches.
// Usage: node scripts/check-tutorial-full.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots/tutorial-full"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));

await page.goto(`${base}/?tutorial=sheep`);
await page.waitForSelector(".draft-board canvas");
await page.waitForTimeout(500);
// Let the bot build until nothing more fits (dev-only hook in SheepTutorial.tsx).
console.log("full:", await page.evaluate(() => window.__tutorialFill()));
await page.waitForTimeout(300);
const done = page.locator(".draft-done");
console.log("done class:", await done.getAttribute("class"), "disabled:", await done.isDisabled());
await page.screenshot({ path: `${out}/full.png` });
if (!(await done.isDisabled())) await done.click();
await page.waitForTimeout(1500);
console.log("launched:", (await page.locator(".arena-canvas").count()) > 0);
await browser.close();
