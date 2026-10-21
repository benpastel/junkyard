// One seat per browser: two tabs of one browser never hold two seats.
// Usage: node scripts/check-seats.mjs <baseUrl> <outDir>
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const [base = "http://localhost:4710", out = "e2e-shots/seats"] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
const tabA = await ctx.newPage();
const tabB = await ctx.newPage();
for (const p of [tabA, tabB]) p.on("pageerror", (e) => console.log("[pageerror]", e.message));
// A separate browser, watching the lobby the way anyone else would.
const watcher = await (await browser.newContext()).newPage();
await watcher.goto(base);
const mine = async () => {
  await watcher.waitForTimeout(800);
  const rows = await watcher.locator(".table-row").allTextContents();
  return rows.filter((r) => r.includes("Ingrid"));
};

await tabA.goto(base);
await tabA.getByLabel("Name").fill("Ingrid");
await tabA.getByRole("button", { name: /new table/i }).click();
await tabA.waitForSelector(".share-row");
const first = new URL(tabA.url()).searchParams.get("r");
console.log("A made", first, "->", await mine());

// A fresh tab opened at the bare site: making another table moves her seat there.
await tabB.goto(base);
await tabB.getByRole("button", { name: /new table/i }).click();
await tabB.waitForSelector(".share-row");
const second = new URL(tabB.url()).searchParams.get("r");
await tabA.waitForTimeout(500);
console.log("B made", second, "->", await mine());
console.log("A shows:", await tabA.locator(".overlay h2").textContent().catch(() => "(no overlay)"));
await tabA.screenshot({ path: `${out}/a-moved.png` });

// Reloading keeps the seat; picking her own table from the lobby in the other tab takes the
// same seat over rather than adding a second Ingrid.
await tabB.reload();
await tabB.waitForSelector(".share-row");
console.log("B reloaded ->", await mine());
await tabA.goto(base);
await tabA.locator(".table-row", { hasText: "Ingrid" }).click();
await tabA.waitForSelector(".share-row");
const rows = await mine();
console.log("A picked her table ->", rows, "Ingrids:", rows.join("").split("Ingrid").length - 1);
console.log("B shows:", await tabB.locator(".overlay h2").textContent().catch(() => "(no overlay)"));

// The id is a UUID; a reload is the same player, so nobody "left" or "joined"; Quit gives the seat up at once.
console.log("id:", await tabA.evaluate(() => localStorage.getItem("ja.player")));
await tabA.reload();
await tabA.waitForSelector(".share-row");
await tabA.waitForTimeout(300);
console.log("chat after reload:", await tabA.locator(".chat-list").textContent());
await tabA.getByRole("button", { name: "Quit" }).click();
console.log("A quit ->", await mine());
await browser.close();
