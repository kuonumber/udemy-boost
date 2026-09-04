import { loadOptions, saveOptions } from "../src/options-store.js";
import { createChromeCache } from "../src/translate/cache.js";
import { availability as chromeAvailability } from "../src/translate/chrome.js";
import { normalizeBaseUrl, isLocalhost } from "../src/translate/libre.js";

const FIELDS = {
  enabled: "checked",
  zhFirst: "checked",
  hideNative: "checked",
  opencc: "checked",
  fontSize: "value",
  bottomOffset: "value",
  provider: "value",
  libreUrl: "value",
  libreApiKey: "value",
  lpEnabled: "checked",
  lpAutoExport: "checked",
  lpRequireFocus: "checked",
  lpIdleMinutes: "value",
};

const cache = createChromeCache();
const $ = (id) => document.getElementById(id);

async function refreshCacheStats() {
  const s = await cache.stats();
  $("cacheStats").textContent = `快取 ${s.entries} 筆 / ${(s.bytes / 1024).toFixed(0)} KB`;
}

async function refreshChromeStatus() {
  const st = await chromeAvailability();
  const text = {
    available: "Chrome Translator：模型已就緒",
    downloadable: "Chrome Translator：可用，第一次會在影片上出現「下載翻譯模型」按鈕",
    downloading: "Chrome Translator：模型下載中",
    unavailable: "Chrome Translator：此 Chrome 不支援 en → zh-Hant（需 Chrome 138+，桌機）",
  }[st];
  $("chromeStatus").textContent = text;
  $("chromeStatus").classList.toggle("warn", st === "unavailable");
}

/** 非 localhost 的 LibreTranslate 網址需要動態要 host permission（必須在 user gesture 內）。 */
async function ensureLibrePermission(url) {
  let base;
  try {
    base = normalizeBaseUrl(url);
  } catch (e) {
    $("libreHint").textContent = `網址無效：${e.message}`;
    $("libreHint").classList.add("warn");
    return;
  }
  $("libreHint").classList.remove("warn");
  if (isLocalhost(base)) {
    $("libreHint").textContent = "localhost 不需額外權限。";
    return;
  }
  const origin = new URL(base).origin + "/*";
  const has = await chrome.permissions.contains({ origins: [origin] });
  if (has) {
    $("libreHint").textContent = `已授權 ${origin}`;
    return;
  }
  const granted = await chrome.permissions.request({ origins: [origin] });
  $("libreHint").textContent = granted ? `已授權 ${origin}` : `未授權 ${origin}，LibreTranslate 會連不上`;
  $("libreHint").classList.toggle("warn", !granted);
}

// ---------- 課程補充資源下載 ----------

let plan = null;
let pollTimer = 0;

function fmtBytes(b) {
  if (b >= 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  return `${Math.ceil(b / 1e3)} KB`;
}

async function activeLearnTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/^https:\/\/www\.udemy\.com\/course\/[^/]+\/learn\//.test(tab.url)) return null;
  return tab;
}

async function scan() {
  $("scanBtn").disabled = true;
  $("dlPlanBox").hidden = true;
  $("dlSummary").textContent = "掃描中…";
  try {
    const tab = await activeLearnTab();
    if (!tab) throw new Error("請先切到 Udemy 課程播放頁（…/learn/lecture/…）再掃描");
    const r = await chrome.tabs.sendMessage(tab.id, { type: "scan" });
    if (!r?.ok) throw new Error(r?.error ?? "掃描失敗");
    plan = r.plan;
    const sizeNote = plan.unknownSizeCount ? `（${plan.unknownSizeCount} 檔大小未知）` : "";
    $("dlSummary").textContent = `${plan.courseTitle}`;
    $("dlPlanDetail").textContent =
      `${plan.items.length} 個檔案，共 ${fmtBytes(plan.totalBytes)}${sizeNote}；${plan.links.length} 個外部連結` +
      (plan.skipped.length ? `；略過 ${plan.skipped.length} 個（${[...new Set(plan.skipped.map((s) => s.reason))].join("、")}）` : "") +
      `。存到 ${plan.root}/`;
    $("dlWarn").textContent = "若之前下載過，同名檔會產生副本。";
    $("dlPlanBox").hidden = plan.items.length === 0 && plan.links.length === 0;
    if ($("dlPlanBox").hidden) $("dlSummary").textContent += "：沒有可下載的資源";
  } catch (e) {
    $("dlSummary").textContent = e.message;
  } finally {
    $("scanBtn").disabled = false;
  }
}

async function refreshProgress() {
  const r = await chrome.runtime.sendMessage({ type: "progress" });
  const job = r?.job;
  if (!job) {
    $("dlProgressBox").hidden = true;
    return;
  }
  $("dlProgressBox").hidden = false;
  $("dlProgress").max = job.total || 1;
  $("dlProgress").value = job.done + job.failed;
  const finished = job.done + job.failed >= job.total || job.cancelled;
  $("dlProgressText").textContent =
    (job.cancelled ? "已取消：" : finished ? "完成：" : "下載中：") +
    `${job.done} 成功 / ${job.failed} 失敗 / ${job.total} 總計` +
    (finished ? "" : `（進行中 ${job.inFlight}，排隊 ${job.queued}）`);
  $("cancelBtn").hidden = finished;
  $("dlFailedBox").hidden = job.failedItems.length === 0;
  $("dlFailed").textContent = job.failedItems.map((f) => `${f.path}\n  ↳ ${f.error}`).join("\n");
  if (finished) {
    clearInterval(pollTimer);
    pollTimer = 0;
  }
}

async function startDownload() {
  if (!plan) return;
  $("startBtn").disabled = true;
  const r = await chrome.runtime.sendMessage({ type: "start", plan });
  $("startBtn").disabled = false;
  if (!r?.ok) {
    $("dlWarn").textContent = `啟動失敗：${r?.error ?? "unknown"}`;
    return;
  }
  $("dlPlanBox").hidden = true;
  await refreshProgress();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshProgress, 1000);
}

async function initDownloadUi() {
  $("scanBtn").addEventListener("click", scan);
  $("startBtn").addEventListener("click", startDownload);
  $("cancelBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "cancel" });
    await refreshProgress();
  });
  await refreshProgress(); // popup 重開時接續顯示進行中的 job
  const r = await chrome.runtime.sendMessage({ type: "progress" });
  if (r?.job && !(r.job.cancelled || r.job.done + r.job.failed >= r.job.total)) pollTimer = setInterval(refreshProgress, 1000);
}

// ---------- 學習歷程 ----------

function fmtDur(ms) {
  if (!ms || ms <= 0) return "—";
  const m = Math.floor(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m` : `${m}m ${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}s`;
}

async function refreshLpSummary() {
  const tab = await activeLearnTab();
  if (!tab) {
    $("lpSummary").textContent = "請在 Udemy 課程播放頁開啟 popup 才能看摘要 / 匯出。";
    $("lpExportBtn").disabled = true;
    $("lpClearBtn").disabled = true;
    return;
  }
  $("lpExportBtn").disabled = false;
  $("lpClearBtn").disabled = false;
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: "lp:summary" });
    if (!r?.ok) throw new Error(r?.error ?? "summary failed");
    const s = r.summary;
    const pct = s.lectures ? Math.round((s.completed / s.lectures) * 100) : 0;
    $("lpSummary").textContent = `${s.title}：${s.completed} / ${s.lectures} 講（${pct}%）· ${s.chaptersDone} / ${s.chapters} 章 · 累計觀看 ${fmtDur(s.watchedMs)}`;
  } catch (e) {
    $("lpSummary").textContent = `摘要讀取失敗：${e.message}`;
  }
}

async function initLearningUi() {
  $("lpExportBtn").addEventListener("click", async () => {
    const tab = await activeLearnTab();
    if (!tab) return;
    $("lpExportBtn").disabled = true;
    try {
      const r = await chrome.tabs.sendMessage(tab.id, { type: "lp:export" });
      if (!r?.ok) throw new Error(r?.error ?? "export failed");
      $("lpHint").textContent = `已匯出：${r.path}`;
    } catch (e) {
      $("lpHint").textContent = `匯出失敗：${e.message}`;
    } finally {
      $("lpExportBtn").disabled = false;
    }
  });
  $("lpClearBtn").addEventListener("click", async () => {
    const tab = await activeLearnTab();
    if (!tab) return;
    if (!confirm("清除這門課在本 extension 的觀看時間與完成時間記錄？（Udemy 上的完成狀態不受影響）")) return;
    const r = await chrome.tabs.sendMessage(tab.id, { type: "lp:clear" });
    $("lpHint").textContent = r?.ok ? "已清除。" : `清除失敗：${r?.error}`;
    await refreshLpSummary();
  });
  await refreshLpSummary();
}

async function init() {
  await initDownloadUi();
  await initLearningUi();
  const opts = await loadOptions();
  for (const [key, prop] of Object.entries(FIELDS)) {
    const el = $(key);
    el[prop] = opts[key];
    el.addEventListener("change", async () => {
      const v = prop === "checked" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
      await saveOptions({ [key]: v });
      if (key === "libreUrl") await ensureLibrePermission(v);
    });
  }
  $("resetPos").addEventListener("click", () => {
    saveOptions({ offsetX: 0, bottomOffset: 80 });
    $("bottomOffset").value = 80;
  });
  $("clearCache").addEventListener("click", async () => {
    await cache.clear();
    await refreshCacheStats();
  });
  await Promise.all([refreshCacheStats(), refreshChromeStatus()]);
}

init();
