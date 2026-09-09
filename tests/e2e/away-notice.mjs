// 重現「離開多久沒顯示」並驗證修好。
//
// 原因：離開判定是從 tracker 的 end_reason 推的，而 fxAutoPause（預設開）在離開 3 秒後
// 把影片暫停 → reason 變 "pause" → 被當成「已回來」→ 離開起點在第 4 秒就被清掉
// （4s < 30s 門檻所以也不顯示），真的回來時已經沒有起點。
//
// 這支測試把分頁切到背景（真的 visibilitychange + 失焦）、確認自動暫停真的發生了、
// 等超過 30 秒門檻後切回來，然後看 overlay 有沒有「離開 …」。
// 註：加了 --disable-background-timer-throttling，否則背景分頁的 setTimeout 會被節流到
// 約每分鐘一次、自動暫停不會在 3 秒時發生，就無法重現這個 bug。
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const HOST = "https://www.udemy.test";
const COURSE_ID = 6775439;
const LECTURE_ID = 52212451;
const AWAY_S = 34; // 門檻 30 秒，多留一點

function buildExt() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ub-away-"));
  fs.cpSync(ROOT, dir, { recursive: true, filter: (src) => !/node_modules|\.git|tests|docs/.test(src) });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  mf.content_scripts[0].matches.push(`${HOST}/course/*/learn/*`);
  mf.host_permissions.push(`${HOST}/*`);
  mf.web_accessible_resources[0].matches.push(`${HOST}/*`);
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 2));
  return dir;
}

const PAGE = `<!doctype html><html><head><title>fake udemy</title></head><body>
<div class="ud-app-loader" data-module-args='{"courseId":${COURSE_ID}}'></div>
<div class="video-player-module--video-container--x" style="width:320px;height:180px">
<video id="v" width="320" height="180" muted loop src="${HOST}/media/v.webm"></video></div></body></html>`;

const extDir = buildExt();
const prof = fs.mkdtempSync(path.join(os.tmpdir(), "ub-awayp-"));
const ctx = await chromium.launchPersistentContext(prof, {
  headless: true,
  ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : { channel: "chromium" }),
  args: [
    `--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`,
    "--disable-background-timer-throttling", "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding",
  ],
});
const media = fs.readFileSync(path.join(ROOT, "tests/e2e/silent12s.webm"));
await ctx.route(`${HOST}/**`, (route) => {
  const u = new URL(route.request().url());
  if (u.pathname === "/media/v.webm") {
    return route.fulfill({ status: 200, headers: { "Content-Type": "video/webm", "Accept-Ranges": "bytes" }, body: media });
  }
  if (u.pathname.startsWith("/api-2.0/")) return route.fulfill({ contentType: "application/json", body: "{}" });
  return route.fulfill({ contentType: "text/html", body: PAGE });
});

const learn = await ctx.newPage();
await learn.goto(`${HOST}/course/blender-start/learn/lecture/${LECTURE_ID}`);
await learn.waitForSelector("#ub-overlay-root", { timeout: 10000 });
await learn.evaluate(async () => {
  const v = document.getElementById("v");
  await Promise.race([v.play(), new Promise((r) => setTimeout(r, 2000))]);
});
await learn.waitForTimeout(2000);
const before = await learn.evaluate(() => ({ paused: document.getElementById("v").paused, toast: document.querySelector("#ub-overlay-root .ub-toast").textContent }));

// ---- 離開：開第二個分頁並切到前景（真的 visibilitychange + 失焦）
const other = await ctx.newPage();
await other.goto("about:blank");
await other.bringToFront();
await other.waitForTimeout(6000);
const duringAway = await learn.evaluate(() => ({
  hidden: document.visibilityState !== "visible",
  focused: document.hasFocus(),
  paused: document.getElementById("v").paused, // fxAutoPause 應該已經把它暫停 → 這正是原本會壞掉的地方
}));
// headless Chromium（此 build）無法產生真的 hidden / blur：bringToFront 不改可見性、
// Emulation.setPageVisibilityOverride 不存在、setFocusEmulationEnabled 只能強制取得焦點。
// 偵測不到離開狀態就誠實 SKIP，不要假裝通過；接線本身由 tests/focus-controls.test.js 覆蓋。
if (!duringAway.hidden && duringAway.focused) {
  console.log(JSON.stringify({ before, duringAway }, null, 1));
  console.log("AWAY SKIP：此環境無法讓分頁真的隱藏 / 失焦，無法端到端驗證。請在真實 Chrome 手動測：");
  console.log("  播放 → 切到別的 app 超過 30 秒 → 切回來，字幕上方應出現「離開 …」");
  await ctx.close();
  fs.rmSync(extDir, { recursive: true, force: true });
  process.exit(0);
}
await other.waitForTimeout((AWAY_S - 6) * 1000);

// ---- 回來
await learn.bringToFront();
const toast = await learn.evaluate(async () => {
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 250));
    const t = document.querySelector("#ub-overlay-root .ub-toast").textContent;
    if (t) return t;
  }
  return "(no toast)";
});
const errs = [];
learn.on("pageerror", (e) => errs.push(e.message));

console.log(JSON.stringify({ before, duringAway, toast }, null, 1));
await ctx.close();
fs.rmSync(extDir, { recursive: true, force: true });

const m = /^離開 (?:(\d+)m )?(\d+)s$/.exec(toast) ?? /^離開 (\d+)m (\d+)s$/.exec(toast);
const secs = m ? Number(m[1] ?? 0) * 60 + Number(m[2]) : -1;
const ok =
  before.paused === false &&
  duringAway.hidden === true &&
  duringAway.focused === false &&
  duringAway.paused === true && // 自動暫停確實發生（原本就是它把離開計時清掉的）
  secs >= AWAY_S - 4 && secs <= AWAY_S + 8; // 離開時間應該接近實際秒數
console.log(`toast="${toast}" → ${secs}s（實際離開約 ${AWAY_S}s）`);
console.log(ok ? "AWAY PASS" : "AWAY FAIL");
process.exit(ok ? 0 : 1);
