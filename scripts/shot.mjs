// Screenshot one page. Usage: node scripts/shot.mjs <url> <out.png> [width=1400] [height=900] [waitMs=3500]
import { chromium } from "playwright";
const [url, out, w = "1400", h = "900", wait = "3500"] = process.argv.slice(2);
const b = await chromium.launch();
const p = await (await b.newContext({ viewport: { width: +w, height: +h } })).newPage();
p.on("pageerror", (e) => console.log("[pageerror]", e.message));
await p.goto(url);
await p.waitForTimeout(+wait);
await p.screenshot({ path: out });
await b.close();
