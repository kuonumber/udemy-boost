// MV3 service worker：接收下載計畫 → chrome.downloads.download()，追蹤進度。
// 狀態存 chrome.storage.session（worker 會被 Chrome 閒置回收，不能靠記憶體）。
import { render as renderLinks } from "./download/links.js";
import { createDriveAuth } from "./drive/flow.js";
import { createDriveClient, DriveAuthError } from "./drive/client.js";
import { ROOT_FOLDER } from "./drive/config.js";
import { createSyncer } from "./sync/orchestrator.js";
import { mergeCsv } from "./sync/csv-merge.js";
import { mergeNotes } from "./sync/notes-merge.js";

const LOG = "[ub:bg]";
const CONCURRENCY = 4;
const JOB_KEY = "dl:job";

// storage.session 存下載 job 與（由 popup 寫入的）Inbox 配對 token。
// 明確鎖在 TRUSTED_CONTEXTS：content script 跑在 udemy.com 頁面上，不得讀到配對 token。
chrome.storage.session.setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" }).catch((e) => console.warn(LOG, "setAccessLevel", e));

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

// ---------- File System Access：經 offscreen document 讀寫 Udemy 資料夾 ----------
const OFFSCREEN_URL = "src/offscreen/offscreen.html";
const FSQ_KEY = "ub:fsq"; // 寫失敗（未選資料夾 / 未授權）時的追加佇列（storage.local，重開瀏覽器不丟）
let offscreenReady = null;

async function ensureOffscreen() {
  if (!offscreenReady) {
    offscreenReady = (async () => {
      if (await chrome.offscreen.hasDocument?.()) return;
      await chrome.offscreen.createDocument({
        url: OFFSCREEN_URL,
        reasons: ["BLOBS"],
        justification: "Read/write progress.md, watch-log.csv and notes.md in the user-selected Udemy folder via File System Access API",
      });
    })().catch((e) => {
      offscreenReady = null;
      // 已存在會丟錯，視為 ready
      if (!/single offscreen|already exists/i.test(String(e?.message))) throw e;
    });
  }
  return offscreenReady;
}

async function fsCall(msg) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ ...msg, target: "offscreen" });
  if (r === undefined) throw new Error("offscreen did not respond");
  return r;
}

async function fsQueuePush(item) {
  const q = (await chrome.storage.local.get(FSQ_KEY))[FSQ_KEY] ?? [];
  q.push(item);
  await chrome.storage.local.set({ [FSQ_KEY]: q });
  return q.length;
}

/** 資料夾可用時把佇列補寫回去；回傳補寫筆數。 */
async function fsFlushQueue() {
  const q = (await chrome.storage.local.get(FSQ_KEY))[FSQ_KEY] ?? [];
  let n = 0;
  for (const item of q) {
    const r = await fsCall({ type: "fs:append", path: item.path, text: item.text, header: item.header });
    if (!r.ok) break;
    n++;
  }
  await chrome.storage.local.set({ [FSQ_KEY]: q.slice(n) });
  return n;
}

// ---------- Google Drive 授權 ----------
// 必須跑在 service worker：launchWebAuthFlow 會開新視窗，popup 隨即被 Chrome 關閉，
// 在 popup 裡跑的話 JS 環境會在換 token 之前就消失（實測：狀態停在「未連結」，沒有任何錯誤）。
const driveAuth = createDriveAuth();

// Drive client 用 Chrome 代管的 token。快取中的 token 仍可能失效（撤銷 / 改密碼），
// 遇到 401 就把它踢出快取重取一次，而不是叫使用者重新授權。
let lastToken = null;
const driveClient = createDriveClient({
  getToken: async () => (lastToken = await driveAuth.getAccessToken()),
});

const SYNC_STATE_KEY = "sync:state";
const syncState = {
  async get(key) {
    return ((await chrome.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY] ?? {})[key] ?? null;
  },
  async set(key, value) {
    const all = (await chrome.storage.local.get(SYNC_STATE_KEY))[SYNC_STATE_KEY] ?? {};
    all[key] = value;
    await chrome.storage.local.set({ [SYNC_STATE_KEY]: all });
  },
};

// 檔案走既有的 offscreen + File System Access 通道；路徑相對於使用者選的 Udemy 資料夾。
const syncFiles = {
  async read(path) {
    const r = await fsCall({ type: "fs:read", path });
    if (!r.ok) throw new Error(r.error ?? "讀取失敗");
    return r.text;
  },
  async write(path, text) {
    const r = await fsCall({ type: "fs:write", path, text });
    if (!r.ok) throw new Error(r.error ?? "寫入失敗");
  },
};

const syncer = createSyncer({ drive: driveClient, files: syncFiles, state: syncState, rootFolder: ROOT_FOLDER });

/**
 * 同步哪些檔：
 * - watch-log.csv：真相來源，集合聯集合併（無衝突）。
 * - notes.md：手寫內容，entry 級合併（同 id 取新、真衝突兩則都留），絕不單邊覆蓋。
 * - progress.md：由 CSV 算出的衍生物，localWins（同步完 CSV 後由播放頁重算再推上去）。
 */
function specsFor(courseDir, only = ["csv", "notes", "md"]) {
  const all = {
    csv: {
      key: `${courseDir}/watch-log.csv`,
      localPath: `${courseDir}/watch-log.csv`,
      remoteName: `${courseDir}__watch-log.csv`,
      mimeType: "text/csv",
      merge: mergeCsv,
    },
    notes: {
      key: `${courseDir}/notes.md`,
      localPath: `${courseDir}/notes.md`,
      remoteName: `${courseDir}__notes.md`,
      mimeType: "text/markdown",
      merge: mergeNotes,
    },
    md: {
      key: `${courseDir}/progress.md`,
      localPath: `${courseDir}/progress.md`,
      remoteName: `${courseDir}__progress.md`,
      mimeType: "text/markdown",
      localWins: true,
    },
  };
  return only.map((k) => all[k]).filter(Boolean);
}

async function runSync(courseDir, only) {
  if (!courseDir) throw new Error("缺少課程名稱");
  const status = await fsCall({ type: "fs:status" });
  if (!(status.ok && status.linked && status.permission === "granted")) {
    throw new Error("尚未連結本機 Udemy 資料夾（設定頁的「Udemy 資料夾」），同步需要讀得到 watch-log.csv");
  }
  try {
    return await syncer.syncAll(specsFor(courseDir, only));
  } catch (e) {
    if (e instanceof DriveAuthError && e.status === 401 && lastToken) {
      await driveAuth.invalidate(lastToken);
      lastToken = null;
      return syncer.syncAll(specsFor(courseDir, only));
    }
    throw e;
  }
}

/** popup → background 的訊息處理；也給 e2e 直接呼叫（SW 收不到自己送的 runtime message）。 */
export async function handleMessage(msg) {
  if (typeof msg?.type === "string" && msg.type.startsWith("fs:")) {
    if (msg.type === "fs:flushQueue") return { ok: true, flushed: await fsFlushQueue() };
    if (msg.type === "fs:queueSize") return { ok: true, size: ((await chrome.storage.local.get(FSQ_KEY))[FSQ_KEY] ?? []).length };
    const r = await fsCall(msg).catch((e) => ({ ok: false, error: e?.message ?? String(e), code: null }));
    if (!r.ok && msg.type === "fs:append" && (r.code === "no-handle" || r.code === "no-permission" || r.code === null)) {
      const size = await fsQueuePush({ path: msg.path, text: msg.text, header: msg.header ?? "" });
      return { ok: false, queued: true, size, code: r.code, error: r.error };
    }
    return r;
  }
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
    case "drive:status":
      return { ok: true, ...(await driveAuth.status()) };
    case "drive:connect":
      return { ok: true, ...(await driveAuth.connect()) };
    case "drive:disconnect":
      return { ok: true, ...(await driveAuth.disconnect()) };
    case "drive:sync":
      return { ok: true, ...(await runSync(msg.courseDir, msg.only)) };
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
