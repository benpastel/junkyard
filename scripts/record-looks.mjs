// Records the same scripted flight in each backdrop style (?look=...) and writes a side-by-side
// page. Usage: node scripts/record-looks.mjs [baseUrl] [outDir]
import { chromium } from "playwright";
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const [base = "http://localhost:4710", out = "mockups/looks"] = process.argv.slice(2);
const LOOKS = {
  current: "Now: disc + mid-distance stars + half-speed dust",
  sky: "Far sky only turns; dust moves with you",
  "sky-fg": "Sky + dust + big foreground rocks",
  "sky-grid": "Sky + faint grid instead of dust",
  "sky-half": "Sky + dust, camera turns half as far",
};
const size = { width: 800, height: 520 };
mkdirSync(out, { recursive: true });

// Arrow keys held for a while each: thrust, turn, drift, turn back.
const SCRIPT = [
  [3600, []],
  [1600, ["ArrowUp"]],
  [1400, ["ArrowUp", "ArrowLeft"]],
  [1200, ["ArrowUp"]],
  [1000, ["ArrowRight"]],
  [1400, ["ArrowUp", "ArrowRight"]],
  [1000, ["ArrowDown"]],
  [1500, []],
];

const browser = await chromium.launch();
for (const look of Object.keys(LOOKS)) {
  const tmp = join(out, `tmp-${look}`);
  rmSync(tmp, { recursive: true, force: true });
  const ctx = await browser.newContext({ viewport: size, recordVideo: { dir: tmp, size } });
  const page = await ctx.newPage();
  await page.goto(`${base}/?sandbox=arena&idle=1&bg=1&look=${look}`);
  for (const [ms, keys] of SCRIPT) {
    for (const k of keys) await page.keyboard.down(k);
    await page.waitForTimeout(ms);
    for (const k of keys) await page.keyboard.up(k);
  }
  await ctx.close();
  const file = readdirSync(tmp).find((f) => f.endsWith(".webm"));
  renameSync(join(tmp, file), join(out, `${look}.webm`));
  rmSync(tmp, { recursive: true, force: true });
  console.log("recorded", look);
}
await browser.close();

const cards = Object.entries(LOOKS)
  .map(([look, label]) => `<figure><video src="${look}.webm" muted playsinline></video><figcaption><b>${look}</b> ${label}</figcaption></figure>`)
  .join("\n");
writeFileSync(
  join(out, "index.html"),
  `<!doctype html><meta charset="utf-8"><title>Backdrop looks</title>
<style>
body{margin:0;padding:16px;background:#0b0d10;color:#d8d4cc;font:14px ui-monospace,Menlo,monospace}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:14px}
figure{margin:0}video{width:100%;display:block;border:1px solid #2c323b}
figcaption{padding:6px 2px}b{color:#e0b23a;margin-right:8px}
button{font:inherit;padding:8px 18px;margin-bottom:12px;background:#20252d;color:#d8d4cc;border:1px solid #3a424d;border-radius:4px;cursor:pointer}
</style>
<button id="play">Play all together</button>
<div class="grid">${cards}</div>
<script>
const vids=[...document.querySelectorAll("video")];
document.getElementById("play").onclick=()=>{vids.forEach(v=>{v.currentTime=0;v.play()})};
vids.forEach(v=>v.addEventListener("click",()=>v.paused?v.play():v.pause()));
</script>`,
);
console.log("wrote", join(out, "index.html"));
