// Flying with the thrust planner: the six-key cockpit lights, WASD/QE work, the touch pad has turn keys.
// Usage: node scripts/check-flight.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots/flight"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 800 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(`${base}/?sandbox=arena`);
await page.waitForSelector(".arena-canvas");
await page.waitForTimeout(4500);
const centre = { x: 350, y: 200, width: 500, height: 400 };
await page.screenshot({ path: `${out}/01-idle.png`, clip: centre });
for (const [name, keys] of [["02-up-W", ["KeyW"]], ["03-turn-right-E", ["KeyE"]], ["04-turn-left-Q", ["KeyQ"]], ["05-left-A-plus-Q", ["KeyA", "KeyQ"]]]) {
  for (const k of keys) await page.keyboard.down(k);
  await page.waitForTimeout(350);
  await page.screenshot({ path: `${out}/${name}.png`, clip: centre });
  for (const k of keys) await page.keyboard.up(k);
  await page.waitForTimeout(600);
}
await browser.close();

// Touch: the pad shows Q W E over A S D.
const phone = await chromium.launch();
const tp = await (await phone.newContext({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true })).newPage();
await tp.goto(`${base}/?sandbox=arena`);
await tp.waitForSelector(".arena-canvas");
await tp.waitForTimeout(3000);
await tp.screenshot({ path: `${out}/06-touch.png` });
console.log("pad keys:", await tp.locator(".arrow-pad .arrow-key").count());
await phone.close();
