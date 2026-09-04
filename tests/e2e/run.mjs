// E2E：用 Playwright 載入未封裝 extension，對一個模擬 Udemy learn 頁跑完整 content script 流程。
// 不需要 Udemy 帳號：API 與 VTT 都由 route 攔截回假資料。
// 執行：node tests/e2e/run.mjs   （需要 playwright 與 chromium；不在 `npm test` 內）
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const COURSE_ID = 6775439;
const LECTURE_ID = 52212451;

// 讓 content script 也注入到測試頁：複製 extension，把 matches 改成含 localhost
function buildTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ub-e2e-"));
  fs.cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => !/node_modules|\.git|tests|docs/.test(src),
  });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  mf.content_scripts[0].matches.push("https://www.udemy.test/*");
  mf.host_permissions.push("https://www.udemy.test/*");
  mf.web_accessible_resources[0].matches.push("https://www.udemy.test/*");
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 2));
  return dir;
}

const PAGE_HTML = `<!doctype html><html><head><title>fake udemy</title></head><body>
<div class="ud-app-loader" data-module-args='{"courseId":${COURSE_ID}}'></div>
<section class="lecture-view--container--x"><div class="video-viewer--container--x"><div class="video-player-module--video-player--x">
<div class="video-player-module--video-container--dsN0B" style="width:640px;height:360px;background:#222">
<video id="v" width="640" height="360" muted src="https://www.udemy.test/media/silent12s.webm"></video>
</div></div></div></section></body></html>`;

const EN_VTT = "WEBVTT\n\n1\n00:04.280 --> 00:05.960\nAnd welcome to the blender program.\n\n2\n00:06.760 --> 00:09.000\nNow let's take a look at the program's interface.\n";
const ZH_VTT = "WEBVTT\r\n\r\n00:00:04.280 --> 00:00:05.960\r\n欢迎来到Blender程序。\r\n\r\n00:00:06.760 --> 00:00:09.000\r\n现在让我们来看一下程序的界面。\r\n";

// chrome.downloads 是瀏覽器層級請求，page.route 攔不到 → 檔案用真的 localhost HTTP server 供應
function startFileServer() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      if (req.url.startsWith("/files/")) {
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": "attachment" });
        res.end("hello" + req.url.slice(-1));
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    srv.listen(0, "127.0.0.1", () => resolve({ srv, base: `http://127.0.0.1:${srv.address().port}` }));
  });
}

async function main() {
  const { srv: fileSrv, base: FILES } = await startFileServer();
  const extDir = buildTestExtension();
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ub-prof-"));
  const ctx = await chromium.launchPersistentContext(userData, {
    headless: true,
    acceptDownloads: true,
    channel: "chromium",
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const page = await ctx.newPage();
  const logs = [];
  page.on("console", (m) => logs.push(`[${m.type()}] ${m.text()}`));
  page.on("pageerror", (e) => logs.push(`[pageerror] ${e.message}`));

  await page.route("https://www.udemy.test/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes("/progress/")) {
      return route.fulfill({ contentType: "application/json", body: JSON.stringify({ _class: "course", id: COURSE_ID, completion_ratio: 50, completed_lecture_ids: [2], num_completed_lectures: 1 }) });
    }
    if (url.pathname.startsWith("/api-2.0/users/me/subscribed-courses/")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          _class: "lecture",
          id: LECTURE_ID,
          asset: {
            _class: "asset",
            id: 67722773,
            captions: [
              { _class: "caption", id: 1, locale_id: "en_US", source: "manual", asset_id: 67722773, url: "https://www.udemy.test/vtt/en.vtt" },
              { _class: "caption", id: 2, locale_id: "zh_HK", source: "manual", asset_id: 67722773, url: "https://www.udemy.test/vtt/zh.vtt" },
            ],
          },
        }),
      });
    }
    if (url.pathname === "/vtt/en.vtt") return route.fulfill({ contentType: "text/vtt", body: EN_VTT });
    if (url.pathname === "/vtt/zh.vtt") return route.fulfill({ contentType: "text/vtt", body: ZH_VTT });
    if (url.pathname === "/media/silent12s.webm") {
      // seeking 需要 Range 支援，否則 currentTime 設不動
      const buf = fs.readFileSync(path.join(ROOT, "tests/e2e/silent12s.webm"));
      const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers()["range"] ?? "");
      if (range) {
        const start = Number(range[1]);
        const end = range[2] ? Number(range[2]) : buf.length - 1;
        return route.fulfill({
          status: 206,
          headers: { "Content-Type": "video/webm", "Accept-Ranges": "bytes", "Content-Range": `bytes ${start}-${end}/${buf.length}` },
          body: buf.subarray(start, end + 1),
        });
      }
      return route.fulfill({ status: 200, headers: { "Content-Type": "video/webm", "Accept-Ranges": "bytes" }, body: buf });
    }
    if (url.pathname.startsWith("/api-2.0/courses/") && url.pathname.includes("subscriber-curriculum-items")) {
      return route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          count: 4, next: null,
          results: [
            { _class: "chapter", id: 1, object_index: 1, title: "Intro: Getting Started" },
            { _class: "lecture", id: LECTURE_ID, object_index: 2, title: "Interface and settings", supplementary_assets: [
              { _class: "asset", id: 100, asset_type: "File", filename: "03-Navigation.blend", title: "03-Navigation.blend", file_size: 5,
                download_urls: { File: [{ label: "download", file: `${FILES}/files/100.blend` }] } },
              { _class: "asset", id: 101, asset_type: "ExternalLink", title: "Blender Library", external_url: "https://drive.google.com/drive/folders/x" },
            ] },
            { _class: "lecture", id: 2, object_index: 3, title: "Object Navigation", supplementary_assets: [
              { _class: "asset", id: 102, asset_type: "File", filename: "notes.pdf", title: "notes.pdf", file_size: 6,
                download_urls: { File: [{ label: "download", file: `${FILES}/files/102.pdf` }] } },
            ] },
            { _class: "quiz", id: 3, object_index: 4, title: "Quiz" },
          ],
        }),
      });
    }
    if (url.pathname.startsWith("/course/")) return route.fulfill({ contentType: "text/html", body: PAGE_HTML });
    return route.fulfill({ status: 404, body: "nf" });
  });

  await page.goto(`https://www.udemy.test/course/blender-start/learn/lecture/${LECTURE_ID}#overview`);
  // 等 overlay 出現且狀態列停止變動
  await page.waitForSelector("#ub-overlay-root", { timeout: 10000 });
  await page.waitForTimeout(2500);

  const result = await page.evaluate(() => {
    const root = document.getElementById("ub-overlay-root");
    return {
      status: root.querySelector(".ub-status").textContent,
      en: root.querySelector(".ub-en").textContent,
      zh: root.querySelector(".ub-zh").textContent,
    };
  });
  // seek 到 7s（真的 <video>，isolated world 讀到的 currentTime 才會變；page world 的 defineProperty 影響不到 content script）
  const at7 = await page.evaluate(async () => {
    const v = document.getElementById("v");
    if (v.readyState < 1) await new Promise((r) => v.addEventListener("loadedmetadata", r, { once: true }));
    v.currentTime = 7;
    await Promise.race([new Promise((r) => v.addEventListener("seeked", r, { once: true })), new Promise((r) => setTimeout(r, 3000))]);
    await new Promise((r) => setTimeout(r, 100));
    const root = document.getElementById("ub-overlay-root");
    return { en: root.querySelector(".ub-en").textContent, zh: root.querySelector(".ub-zh").textContent, rs: v.readyState, ct: v.currentTime, dur: v.duration, err: v.error?.message ?? null };
  });

  // ---------- Phase 4：播 3 秒 → storage 有 watchedMs；匯出 progress.md ----------
  await page.evaluate(async () => {
    const v = document.getElementById("v");
    v.currentTime = 0;
    await v.play();
  });
  await page.waitForTimeout(3400);
  await page.evaluate(() => document.getElementById("v").pause());
  const swForLp = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const lp = await swForLp.evaluate(async (courseId) => {
    const [tab] = await chrome.tabs.query({ url: "https://www.udemy.test/*" });
    const exp = await chrome.tabs.sendMessage(tab.id, { type: "lp:export" }); // 內含 flush
    const stored = (await chrome.storage.local.get(`lp:${courseId}`))[`lp:${courseId}`];
    await new Promise((r) => setTimeout(r, 800));
    const items = await chrome.downloads.search({});
    const md = items.map((d) => d.url).find((u) => u.startsWith("data:text/markdown") && decodeURIComponent(u).includes("進度"));
    return { exp, lectures: stored?.lectures, md: md ? decodeURIComponent(md.split(",").slice(1).join(",")) : null };
  }, COURSE_ID);
  console.log("learning:", JSON.stringify({ exp: lp.exp, lectures: lp.lectures }, null, 1));
  console.log("progress.md:\n" + lp.md);

  // ---------- Phase 3：scan → start → progress → 檔案落地 ----------
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const dl = await sw.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "https://www.udemy.test/*" });
    const scan = await chrome.tabs.sendMessage(tab.id, { type: "scan" });
    if (!scan?.ok) return { error: "scan: " + scan?.error };
    const plan = scan.plan;
    // 直接呼叫 background 自己的 handler（等同 popup 送 start）
    const start = await globalThis.__ubHandleMessage({ type: "start", plan });
    let job = null;
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 250));
      job = (await globalThis.__ubHandleMessage({ type: "progress" })).job;
      if (job && job.done + job.failed >= job.total) break;
    }
    const items = await chrome.downloads.search({});
    return { plan: { items: plan.items.map((i) => i.path), links: plan.links.length, skipped: plan.skipped, total: plan.totalBytes, title: plan.courseTitle }, start, job,
      // Playwright 會把下載檔改名成 artifact UUID，所以用 url 辨識；links.md 的內容從 data: URL 解回來
      downloads: items.map((d) => ({ state: d.state, bytes: d.fileSize, kind: d.url.startsWith("data:") ? (decodeURIComponent(d.url).includes("進度") ? "progress.md" : "links.md") : d.url.split("/").pop() })),
      linksMd: decodeURIComponent((items.find((d) => d.url.startsWith("data:") && !decodeURIComponent(d.url).includes("進度"))?.url ?? "").split(",").slice(1).join(",")) };
  });
  console.log("download:", JSON.stringify(dl, null, 1));

  await ctx.close();
  fileSrv.close();
  fs.rmSync(extDir, { recursive: true, force: true });
  fs.rmSync(userData, { recursive: true, force: true });

  console.log("status:", JSON.stringify(result.status));
  console.log("at t=7:", JSON.stringify(at7));
  console.log("--- console ---");
  for (const l of logs.filter((l) => /ub|Error|error/.test(l))) console.log(l);

  const dlOk =
    dl.job && dl.job.done === 3 && dl.job.failed === 0 &&
    dl.plan.items[0] === "Udemy/fake udemy/01. Intro Getting Started/02. Interface and settings/03-Navigation.blend" &&
    dl.plan.skipped.length === 0 &&
    ["100.blend", "102.pdf", "links.md"].every((k) => dl.downloads.some((d) => d.kind === k && d.state === "complete")) &&
    dl.linksMd.includes("- [Blender Library](https://drive.google.com/drive/folders/x) — 02. Interface and settings");
  console.log("download check:", dlOk ? "ok" : "FAIL");
  const rec = lp.lectures?.[String(LECTURE_ID)];
  const lpOk =
    lp.exp?.ok === true &&
    lp.exp.path === "Udemy/fake udemy/progress.md" &&
    rec && rec.watchedMs >= 2000 && rec.watchedMs <= 4000 &&
    lp.lectures?.["2"]?.completedBefore === true &&
    lp.md && lp.md.includes("| 2 | Interface and settings | ▶ 進行中 |") && lp.md.includes("| 3 | Object Navigation | ✅ | — | （安裝前） |") &&
    lp.md.includes("進度：1 / 2 講（50%）");
  console.log("learning check:", lpOk ? "ok" : "FAIL");
  const ok = dlOk && lpOk &&
    at7.en === "Now let's take a look at the program's interface." &&
    at7.zh === "現在讓我們來看一下程式的介面。" &&
    /繁體/.test(result.status) &&
    !/失敗/.test(result.status);
  console.log(ok ? "E2E PASS" : "E2E FAIL");
  process.exit(ok ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
