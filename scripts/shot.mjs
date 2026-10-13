// Screenshot a URL: node scripts/shot.mjs <url> <out.png> [waitMs] [width] [height]
import { chromium } from "playwright";

const [url, out, waitMs = "1500", w = "1400", h = "900"] = process.argv.slice(2);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
page.on("console", (m) => console.log(`[console.${m.type()}]`, m.text()));
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto(url);
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
await browser.close();
