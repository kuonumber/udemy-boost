// MV3 service worker：接收下載計畫 → chrome.downloads.download()，追蹤進度。
// 狀態存 chrome.storage.session（worker 會被 Chrome 閒置回收，不能靠記憶體）。
import { render as renderLinks } from "./download/links.js";

const LOG = "[ub:bg]";
const CONCURRENCY = 4;
const JOB_KEY = "dl:job";

// onChanged 事件會並發進來，read-modify-write 要序列化，否則 done/failed 會漏算
let lock = Promise.resolve();
function withLock(fn) {
  const run = lock.then(fn, fn);
  lock = run.catch(() => {});
  return run;
}

async function getJob() {
  return (await chrome.storage.session.get(JOB_KEY))[JOB_KEY] ?? null;
}
async function setJob(job) {
  await chrome.storage.session.set({ [JOB_KEY]: job });
}

function newJob(plan) {
  return {
    id: `job-${Date.now()}`,
    cancelled: false,
    total: plan.items.length + (plan.links.length ? 1 : 0),
    done: 0,
    failed: 0,
    queue: plan.items.map((i) => ({ url: i.url, path: i.path })),
    inFlight: {}, // downloadId → path
    failedItems: [],
    linksMd: plan.links.length ? { path: `${plan.root}/links.md`, body: renderLinks(plan.courseTitle, plan.links) } : null,
  };
}

// download() 的 filename 只是「建議」，Windows 上實測會被 CDN 的 Content-Disposition 蓋掉、且子目錄消失。
// 保險做法：在 onDeterminingFilename 再強制指定一次。download() 回 id 之前事件就可能先到，
// 所以先以 url 登記到記憶體 map（此時 SW 一定活著），事件端用 url 或 id 查。
const pendingByUrl = new Map(); // url → { path, conflictAction }

function registerName(url, path, conflictAction) {
  pendingByUrl.set(url, { path, conflictAction });
}

chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
  const hit = pendingByUrl.get(item.url) ?? pendingByUrl.get(item.finalUrl);
  if (hit) {
    pendingByUrl.delete(item.url);
    pendingByUrl.delete(item.finalUrl);
    suggest({ filename: hit.path, conflictAction: hit.conflictAction });
    return;
  }
  // 記憶體 map 沒有（SW 曾被回收）→ 查 storage 的 inFlight，非同步 suggest
  getJob().then((job) => {
    const path = job?.inFlight?.[item.id];
    if (path) suggest({ filename: path, conflictAction: "uniquify" });
    else suggest();
  });
  return true;
});

async function startDownload(job, item) {
  try {
    registerName(item.url, item.path, "uniquify");
    const id = await chrome.downloads.download({ url: item.url, filename: item.path, conflictAction: "uniquify", saveAs: false });
    job.inFlight[id] = item.path;
  } catch (e) {
    pendingByUrl.delete(item.url);
    job.failed++;
    job.failedItems.push({ path: item.path, error: e?.message ?? String(e) });
  }
}

/** 把 queue 補滿到 CONCURRENCY 個進行中。 */
function pump() {
  return withLock(pumpUnlocked);
}
async function pumpUnlocked() {
  const job = await getJob();
  if (!job || job.cancelled) return;
  while (Object.keys(job.inFlight).length < CONCURRENCY && job.queue.length > 0) {
    await startDownload(job, job.queue.shift());
  }
  if (job.queue.length === 0 && Object.keys(job.inFlight).length === 0 && job.linksMd) {
    const md = job.linksMd;
    job.linksMd = null;
    try {
      const url = "data:text/markdown;charset=utf-8," + encodeURIComponent(md.body);
      registerName(url, md.path, "overwrite");
      const id = await chrome.downloads.download({ url, filename: md.path, conflictAction: "overwrite", saveAs: false });
      job.inFlight[id] = md.path;
    } catch (e) {
      job.failed++;
      job.failedItems.push({ path: md.path, error: e?.message ?? String(e) });
    }
  }
  await setJob(job);
}

chrome.downloads.onChanged.addListener((delta) =>
  withLock(async () => {
    const job = await getJob();
    if (!job || !(delta.id in job.inFlight)) return;
    const state = delta.state?.current;
    if (state === "complete") {
      job.done++;
      delete job.inFlight[delta.id];
    } else if (state === "interrupted") {
      job.failed++;
      job.failedItems.push({ path: job.inFlight[delta.id], error: delta.error?.current ?? "interrupted" });
      delete job.inFlight[delta.id];
    } else {
      return;
    }
    await setJob(job);
    await pumpUnlocked();
  }),
);

/** popup → background 的訊息處理；也給 e2e 直接呼叫（SW 收不到自己送的 runtime message）。 */
export async function handleMessage(msg) {
  switch (msg?.type) {
    case "start": {
      const job = newJob(msg.plan);
      await withLock(() => setJob(job));
      await pump();
      return { ok: true, jobId: job.id };
    }
    case "progress": {
      const job = await getJob();
      if (!job) return { ok: true, job: null };
      const { id, total, done, failed, failedItems, cancelled } = job;
      return {
        ok: true,
        job: { id, total, done, failed, failedItems, cancelled, inFlight: Object.keys(job.inFlight).length, queued: job.queue.length },
      };
    }
    case "cancel": {
      await withLock(async () => {
        const job = await getJob();
        if (!job) return;
        job.cancelled = true;
        job.queue = [];
        job.linksMd = null;
        for (const id of Object.keys(job.inFlight)) {
          try {
            await chrome.downloads.cancel(Number(id));
          } catch (e) {
            console.warn(LOG, "cancel", id, e);
          }
        }
        await setJob(job);
      });
      return { ok: true };
    }
    case "downloadText": {
      // 單檔文字下載（progress.md 等）：overwrite，沿用 onDeterminingFilename 強制路徑
      const url = `data:${msg.mime ?? "text/plain"};charset=utf-8,` + encodeURIComponent(msg.body ?? "");
      registerName(url, msg.path, "overwrite");
      const id = await chrome.downloads.download({ url, filename: msg.path, conflictAction: "overwrite", saveAs: false });
      return { ok: true, id };
    }
    case "clearJob": {
      await chrome.storage.session.remove(JOB_KEY);
      return { ok: true };
    }
    default:
      // 不回應會讓呼叫端永遠等（這正是 0.4.0 開發時 export 卡死的原因），一律回錯誤
      return { ok: false, error: `unknown message type: ${msg?.type}` };
  }
}
globalThis.__ubHandleMessage = handleMessage;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(
    (r) => {
      if (r !== undefined) sendResponse(r);
    },
    (e) => sendResponse({ ok: false, error: e?.message ?? String(e) }),
  );
  return true; // async sendResponse
});
