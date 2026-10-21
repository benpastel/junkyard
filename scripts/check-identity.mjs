// Renaming yourself and changing colour at the table.
// Usage: node scripts/check-identity.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots/identity"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const shot = (name) => page.screenshot({ path: `${out}/${name}.png`, clip: { x: 150, y: 20, width: 760, height: 320 } });

await page.goto(base);
await page.getByLabel("Name").fill("Benji");
await page.getByRole("button", { name: /new table/i }).click();
await page.waitForSelector(".share-row");
await page.waitForTimeout(300);
await page.getByLabel("Change your name").hover();
await shot("01-name-hover");
await page.getByLabel("Change colour").hover();
await shot("02-color-hover");
await page.getByLabel("Change colour").click();
await shot("03-swatches");
await page.locator(".swatch-option:not(:disabled)").nth(3).click();
await page.getByLabel("Change your name").click();
await page.keyboard.type("Ada");
await shot("04-editing");
await page.keyboard.press("Enter");
await page.waitForTimeout(300);
await shot("05-renamed");
console.log("name now:", await page.getByLabel("Change your name").textContent());
console.log("chat:", await page.locator(".chat-list").textContent());
// The new name survives a reload (rejoin).
await page.reload();
await page.waitForSelector(".share-row");
await page.waitForTimeout(500);
console.log("after reload:", await page.getByLabel("Change your name").textContent());
await browser.close();
