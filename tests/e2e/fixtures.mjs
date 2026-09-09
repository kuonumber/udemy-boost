// e2e 共用 fixture：假 Udemy learn 頁、字幕、curriculum route，以及未封裝 extension 的載入方式。
// 由 run.mjs（完整流程）與 inbox-bridge.mjs（真實 anki-mcp-server 整合）共用。
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import http from "node:http";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const COURSE_ID = 6775439;
export const LECTURE_ID = 52212451;
export const LECTURE_URL = `https://www.udemy.com/course/blender-start/learn/lecture/${LECTURE_ID}#overview`;

export function browserExecutable() {
  const candidates = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
    chromium.executablePath(),
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(os.homedir(), "AppData", "Local", "Google", "Chrome", "Application", "chrome.exe"),
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate));
}

// 讓 content script 也注入到測試頁：複製 extension 到暫存目錄（排除 node_modules / .git / tests / docs）
export function buildTestExtension() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ub-e2e-"));
  fs.cpSync(ROOT, dir, {
    recursive: true,
    filter: (src) => !/node_modules|\.git|tests|docs/.test(src),
  });
  const mf = JSON.parse(fs.readFileSync(path.join(dir, "manifest.json"), "utf8"));
  fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(mf, null, 2));
  return dir;
}

// Chromium 的 unpacked extension 測試需 headed mode；回傳 context 與 extension id（來自 service worker URL）
export async function launchWithExtension(extDir) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "ub-prof-"));
  const executablePath = browserExecutable();
  const ctx = await chromium.launchPersistentContext(userData, {
    headless: false,
    acceptDownloads: true,
    ...(executablePath ? { executablePath } : { channel: "chromium" }),
    args: [`--disable-extensions-except=${extDir}`, `--load-extension=${extDir}`],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  return { ctx, userData, sw, extensionId: new URL(sw.url()).host };
}

export const PAGE_HTML = `<!doctype html><html><head><title>fake udemy</title></head><body>
<div class="ud-app-loader" data-module-args='{"courseId":${COURSE_ID}}'></div>
<section class="lecture-view--container--x"><div class="video-viewer--container--x"><div class="video-player-module--video-player--x">
<div class="video-player-module--video-container--dsN0B" style="width:640px;height:360px;background:#222">
<video id="v" width="640" height="360" muted src="https://www.udemy.com/media/silent12s.webm"></video>
</div></div></div></section></body></html>`;

export const EN_VTT = "WEBVTT\n\n1\n00:04.280 --> 00:05.960\nAnd welcome to the blender program.\n\n2\n00:06.760 --> 00:09.000\nNow let's take a look at the program's interface.\n";
export const ZH_VTT = "WEBVTT\r\n\r\n00:00:04.280 --> 00:00:05.960\r\n欢迎来到Blender程序。\r\n\r\n00:00:06.760 --> 00:00:09.000\r\n现在让我们来看一下程序的界面。\r\n";

// chrome.downloads 是瀏覽器層級請求，page.route 攔不到 → 檔案用真的 localhost HTTP server 供應
export function startFileServer() {
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

// 假 Udemy API / VTT / 影片 route handler。FILES 為補充資源檔案 server base（沒有下載流程時可省略）
export function udemyRouteHandler({ FILES = "http://127.0.0.1:0" } = {}) {
  return async (route) => {
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
              { _class: "caption", id: 1, locale_id: "en_US", source: "manual", asset_id: 67722773, url: "https://www.udemy.com/vtt/en.vtt" },
              { _class: "caption", id: 2, locale_id: "zh_HK", source: "manual", asset_id: 67722773, url: "https://www.udemy.com/vtt/zh.vtt" },
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
  };
}

// AnkiConnect mock：在瀏覽器層攔 127.0.0.1:8765 並記錄每次 action；真實 Anki 即使在跑也不會被碰到。
export async function mockAnkiConnect(ctx, { models = ["Basic", "Cloze"] } = {}) {
  const calls = [];
  await ctx.route("http://127.0.0.1:8765/**", async (route) => {
    const request = route.request();
    const headers = {
      "Access-Control-Allow-Origin": request.headers().origin ?? "*",
      "Access-Control-Allow-Headers": "authorization,content-type",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Content-Type": "application/json",
    };
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers, body: "" });
    const body = request.postDataJSON();
    calls.push(body);
    const noteCount = body.params?.notes?.length ?? 0;
    const result = ({
      version: 6,
      deckNames: [],
      createDeck: 1,
      modelNames: models,
      findNotes: [],
      canAddNotes: Array.from({ length: noteCount }, () => true),
      addNotes: Array.from({ length: noteCount }, (_v, i) => 201 + i),
    })[body.action];
    return route.fulfill({ headers, body: JSON.stringify({ result, error: null }) });
  });
  return calls;
}
