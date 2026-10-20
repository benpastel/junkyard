// Team game end to end: switch the table to teams, move a player, launch, and play to the results.
// Usage: node scripts/check-teams.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots/teams"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
const shot = async (name) => {
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log("shot", name);
};

await page.goto(base);
await page.getByLabel("Name").fill("Benji");
await page.getByRole("button", { name: /new table/i }).click();
await page.waitForSelector(".share-row");
await page.waitForTimeout(300);
await shot("01-ffa");
await page.getByRole("button", { name: "Teams" }).click();
await page.waitForSelector(".teams");
await page.waitForTimeout(300);
await shot("02-teams");
// Friendly fire off, and the shortest build.
await page.getByRole("button", { name: "Off" }).click();
await page.getByRole("button", { name: "Frantic" }).click();
await page.getByRole("button", { name: /switch benji's team/i }).click();
await page.waitForTimeout(300);
await shot("03-teams-moved");

await page.getByRole("button", { name: /launch/i }).click();
await page.waitForSelector(".draft-board");
await page.waitForTimeout(1500);
await shot("04-draft");
await page.getByRole("button", { name: /done/i }).first().click().catch(() => {});

await page.waitForSelector(".arena-canvas", { timeout: 90000 });
await page.waitForTimeout(4000);
await shot("05-arena");

await page.waitForSelector(".results-title", { timeout: 300000 });
await page.waitForTimeout(500);
await shot("06-results");
console.log("title:", await page.locator(".results-title").textContent());
await browser.close();
