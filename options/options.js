import { loadOptions, saveOptions } from "../src/options-store.js";
import { createChromeCache } from "../src/translate/cache.js";
import { availability as chromeAvailability } from "../src/translate/chrome.js";
import { normalizeBaseUrl } from "../src/translate/libre.js";
import { saveHandle, loadHandle, clearHandle, permissionState } from "../src/fs/handle-store.js";
import { isLearnUrl, learnPatterns } from "../src/learn-url.js";
import { readCardJsonFile } from "../src/anki/file.js";
import { validateCardPackage, draftKey } from "../src/anki/cards.js";
import { createDraft, draftPackage, editDraftCard, selectedPendingIndices, markSyncResults } from "../src/anki/draft.js";
import { syncCardsToAnki } from "../src/anki/client.js";
import { createInboxClient } from "../src/anki/inbox.js";

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
  fxAutoPause: "checked",
  fxAutoPauseDelayS: "value",
  fxPomodoro: "checked",
  fxPomodoroMin: "value",
  fxRecallPrompt: "checked",
  fxTodayMinutes: "checked",
  fxAwayNotice: "checked",
  ankiProcessor: "value",
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
  // 0.6.0 起 host_permissions 只留 udemy.com 與 AnkiConnect 的 127.0.0.1:8765，
  // localhost:5000 這類 LibreTranslate 位址一律走 optional permission，按鈕點一次即可。
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

/**
 * 找課程播放頁分頁。優先當前分頁；設定頁以 ?mode=tab 開在分頁時，當前分頁是設定頁自己，
 * 這時要去找其他 Udemy 分頁（0.5.1 的 bug：只看 active tab，分頁模式下四個按鈕全部失效）。
 */
async function activeLearnTab() {
  const patterns = learnPatterns();
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (isLearnUrl(active?.url, patterns)) return active;
  const tabs = await chrome.tabs.query({ url: patterns }).catch(() => []);
  return tabs.find((t) => t.active) ?? tabs[0] ?? null;
}

/**
 * 確保分頁裡有 content script。
 * extension 重新載入 / 更新後，既有分頁不會自動注入，直接 sendMessage 會得到
 * 「Could not establish connection. Receiving end does not exist.」——這裡補注入再重試。
 */
async function ensureContentScript(tabId) {
  const ping = async () => {
    try {
      return (await chrome.tabs.sendMessage(tabId, { type: "ping" }))?.ok === true;
    } catch {
      return false;
    }
  };
  if (await ping()) return;
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["src/content.js"] });
  } catch (e) {
    throw new Error(`無法注入 content script（${e.message}）。請重新整理該 Udemy 分頁後再試。`);
  }
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 150));
    if (await ping()) return;
  }
  throw new Error("content script 注入後沒有回應，請重新整理該 Udemy 分頁後再試。");
}

/** 送訊息給播放頁；找不到分頁或缺 content script 都給看得懂的訊息。 */
async function sendToLearnTab(msg) {
  const tab = await activeLearnTab();
  if (!tab) throw new Error("找不到 Udemy 課程播放頁，請先開啟 …/learn/lecture/… 的分頁");
  await ensureContentScript(tab.id);
  const r = await chrome.tabs.sendMessage(tab.id, msg);
  if (!r?.ok) throw new Error(r?.error ?? "播放頁沒有回應");
  return r;
}

async function scan() {
  $("scanBtn").disabled = true;
  $("dlPlanBox").hidden = true;
  $("dlSummary").textContent = "掃描中…";
  try {
    const r = await sendToLearnTab({ type: "scan" });
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
  const has = !!tab;
  $("lpExportBtn").disabled = !has;
  $("lpClearBtn").disabled = !has;
  if (!has) {
    $("lpSummary").textContent = "找不到 Udemy 課程播放頁分頁，請先開啟 …/learn/lecture/…";
    return;
  }
  try {
    const r = await sendToLearnTab({ type: "lp:summary" });
    const s = r.summary;
    const pct = s.lectures ? Math.round((s.completed / s.lectures) * 100) : 0;
    $("lpSummary").textContent = `${s.title}：${s.completed} / ${s.lectures} 講（${pct}%）· ${s.chaptersDone} / ${s.chapters} 章 · 累計觀看 ${fmtDur(s.watchedMs)}`;
  } catch (e) {
    $("lpSummary").textContent = `摘要讀取失敗：${e.message}`;
  }
}

async function initLearningUi() {
  $("lpExportBtn").addEventListener("click", async () => {
    $("lpExportBtn").disabled = true;
    try {
      const r = await sendToLearnTab({ type: "lp:export" });
      $("lpHint").textContent = `已匯出：${r.path}${r.mode === "folder" ? "（直寫資料夾）" : "（下載模式）"}`;
    } catch (e) {
      $("lpHint").textContent = `匯出失敗：${e.message}`;
    } finally {
      $("lpExportBtn").disabled = false;
    }
  });
  $("lpClearBtn").addEventListener("click", async () => {
    if (!confirm("清除這門課在本 extension 的觀看時間與完成時間記錄？（Udemy 上的完成狀態不受影響）")) return;
    try {
      await sendToLearnTab({ type: "lp:clear" });
      $("lpHint").textContent = "已清除。";
    } catch (e) {
      $("lpHint").textContent = `清除失敗：${e.message}`;
    }
    await refreshLpSummary();
  });
  await refreshLpSummary();
}

// ---------- Udemy 資料夾（File System Access） ----------

const IS_TAB = new URLSearchParams(location.search).get("mode") === "tab";

async function refreshFsStatus() {
  const h = await loadHandle();
  const perm = await permissionState(h);
  const q = await chrome.runtime.sendMessage({ type: "fs:queueSize" }).catch(() => null);
  const qs = q?.size ? `　佇列中 ${q.size} 筆待寫入` : "";
  if (!h) {
    $("fsStatus").textContent = "未連結（下載模式）";
    $("fsReauthBtn").hidden = true;
    $("fsUnlinkBtn").hidden = true;
  } else if (perm === "granted") {
    $("fsStatus").textContent = `已連結：${h.name}/`;
    $("fsReauthBtn").hidden = true;
    $("fsUnlinkBtn").hidden = false;
    if (q?.size) await chrome.runtime.sendMessage({ type: "fs:flushQueue" }).catch(() => {});
  } else {
    $("fsStatus").textContent = `已選 ${h.name}/ 但需重新授權（${perm}）`;
    $("fsReauthBtn").hidden = false;
    $("fsUnlinkBtn").hidden = false;
  }
  $("fsQueue").textContent = qs;
}

async function pickFolder() {
  if (!IS_TAB) {
    // popup 開檔案選擇器會被關掉，改在分頁開設定頁
    await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html?mode=tab#fs") });
    return;
  }
  try {
    const h = await window.showDirectoryPicker({ mode: "readwrite", id: "udemy-root" });
    await saveHandle(h);
    await chrome.runtime.sendMessage({ type: "fs:flushQueue" }).catch(() => {});
  } catch (e) {
    if (e?.name !== "AbortError") $("fsStatus").textContent = `選擇失敗：${e.message}`;
  }
  await refreshFsStatus();
}

async function initFsUi() {
  $("fsPickBtn").addEventListener("click", pickFolder);
  $("fsReauthBtn").addEventListener("click", async () => {
    const h = await loadHandle();
    if (!h) return;
    try {
      await h.requestPermission({ mode: "readwrite" });
    } catch (e) {
      $("fsStatus").textContent = `授權失敗：${e.message}`;
    }
    await refreshFsStatus();
  });
  $("fsUnlinkBtn").addEventListener("click", async () => {
    await clearHandle();
    await refreshFsStatus();
  });
  if (IS_TAB) document.body.style.width = "480px";
  await refreshFsStatus();
  if (location.hash === "#fs") document.getElementById("fsPickBtn")?.scrollIntoView();
}

// ---------- GPT → Anki（學習包 → 本機 Inbox / JSON → 審核 → AnkiConnect） ----------

// 配對 token 只放 storage.session，且 background 已把 session 鎖成 TRUSTED_CONTEXTS：
// content script 跑在 udemy.com 頁面上，讀不到這個 key。
const ANKI_TOKEN_KEY = "anki:inboxToken";
const ANKI_LAST_KEY = "anki:lastDraftKey";
const POLL_MS = 2000;
const POLL_MAX = 150; // 約 5 分鐘

let draft = null;
let draftStoreKey = null;
let ankiPollTimer = 0;

async function getAnkiToken() {
  const v = await chrome.storage.session.get([ANKI_TOKEN_KEY]);
  return typeof v?.[ANKI_TOKEN_KEY] === "string" ? v[ANKI_TOKEN_KEY] : "";
}

async function setAnkiToken(token) {
  await chrome.storage.session.set({ [ANKI_TOKEN_KEY]: token });
}

function ankiStatus(text, warn = false) {
  $("ankiStatus").textContent = text;
  $("ankiStatus").classList.toggle("warn", warn);
}

async function inboxClient() {
  const token = (await getAnkiToken()) || $("ankiToken").value.trim();
  if (!token) throw new Error("請先輸入 server 產生的配對 token。");
  await setAnkiToken(token);
  return createInboxClient({ token });
}

async function saveDraft() {
  if (!draftStoreKey) return;
  if (draft) await chrome.storage.local.set({ [draftStoreKey]: draft, [ANKI_LAST_KEY]: draftStoreKey });
  else await chrome.storage.local.remove(draftStoreKey);
}

/** 取得目前播放頁的學習包（course / unit / 字幕）。 */
async function fetchStudyPack() {
  const r = await sendToLearnTab({ type: "anki:pack" });
  return r.pack;
}

function cardTimeLabel(card) {
  const f = (v) => `${Math.floor(v / 60)}:${String(Math.floor(v % 60)).padStart(2, "0")}`;
  return `${f(card.sourceStartSec)}–${f(card.sourceEndSec)}`;
}

function editField(index, key, value) {
  try {
    draft = editDraftCard(draft, index, { [key]: value });
    ankiStatus(`已更新第 ${index + 1} 張卡片。`);
  } catch (e) {
    ankiStatus(`第 ${index + 1} 張卡片修改無效：${e.message}`, true);
    return false;
  }
  saveDraft();
  renderCards();
  return true;
}

function renderCards() {
  const box = $("ankiCards");
  box.textContent = "";
  if (!draft) {
    $("ankiSyncBtn").disabled = true;
    return;
  }
  draft.cards.forEach((entry, index) => {
    const card = entry.card;
    const el = document.createElement("div");
    el.className = "anki-card";
    const head = document.createElement("header");
    const box2 = document.createElement("input");
    box2.type = "checkbox";
    box2.checked = entry.selected;
    box2.addEventListener("change", () => editField(index, "selected", box2.checked));
    head.append(box2, document.createTextNode(`${index + 1}. ${card.type} · ${cardTimeLabel(card)}`));
    const st = document.createElement("span");
    st.className = `st ${entry.syncStatus}`;
    st.textContent = { pending: "", added: `已新增 ${entry.noteId ?? ""}`, duplicate: "已存在", rejected: "被拒絕", failed: entry.error ?? "失敗" }[entry.syncStatus] ?? entry.syncStatus;
    head.append(st);
    el.append(head);
    for (const key of card.type === "basic" ? ["front", "back"] : ["text", "extra"]) {
      const ta = document.createElement("textarea");
      ta.rows = key === "front" || key === "text" ? 2 : 3;
      ta.value = card[key];
      ta.title = key;
      ta.addEventListener("change", () => {
        if (!editField(index, key, ta.value)) ta.value = card[key];
      });
      el.append(ta);
    }
    box.append(el);
  });
  $("ankiSyncBtn").disabled = selectedPendingIndices(draft).length === 0;
}

/** 從 inbox / JSON 取得的卡片一律重新驗證，並要求與目前頁面的 course / unit 相符。 */
function adoptPackage(raw, pack, { itemId = null } = {}) {
  const validated = validateCardPackage(raw, { expectedCourse: pack.course, expectedUnit: pack.unit });
  draftStoreKey = draftKey(pack.course.id, pack.unit.id);
  draft = createDraft(validated, { itemId });
  saveDraft();
  renderCards();
  return validated.cards.length;
}

function stopPoll() {
  if (ankiPollTimer) clearInterval(ankiPollTimer);
  ankiPollTimer = 0;
}

function pollItem(client, itemId, pack) {
  stopPoll();
  let ticks = 0;
  ankiPollTimer = setInterval(async () => {
    if (++ticks > POLL_MAX) {
      stopPoll();
      ankiStatus("等待處理逾時；item 仍在本機 Inbox，可稍後再開設定頁查看。", true);
      return;
    }
    try {
      const item = await client.getItem(itemId);
      if (item.status === "pending" || item.status === "processing") {
        ankiStatus(`${$("ankiProcessor").value === "claude" ? "Claude" : "Codex"} 處理中（${item.status}）…`);
        return;
      }
      stopPoll();
      if (item.status === "failed") {
        ankiStatus(`處理失敗：${item.error ?? item.reason ?? "未提供原因"}`, true);
        return;
      }
      ankiStatus("卡片草稿已完成，正在驗證…");
      const n = adoptPackage({ schemaVersion: 1, course: pack.course, unit: pack.unit, cards: item.cards ?? [], warnings: item.warnings ?? [] }, pack, { itemId });
      ankiStatus(`已載入 ${n} 張卡片，請審核後再同步。`);
    } catch (e) {
      stopPoll();
      ankiStatus(`讀取 Inbox 失敗：${e.message}`, true);
    }
  }, POLL_MS);
}

async function initAnkiUi() {
  $("ankiOrigin").textContent = location.origin;
  const token = await getAnkiToken();
  if (token) $("ankiToken").value = token;

  const last = (await chrome.storage.local.get(ANKI_LAST_KEY))[ANKI_LAST_KEY];
  if (typeof last === "string") {
    const saved = (await chrome.storage.local.get(last))[last];
    if (saved?.cards?.length) {
      draft = saved;
      draftStoreKey = last;
      renderCards();
      ankiStatus(`已載入本機草稿（${saved.cards.length} 張，${saved.updatedAt}）。`);
    }
  }

  $("ankiToken").addEventListener("change", () => setAnkiToken($("ankiToken").value.trim()));

  $("ankiConnectBtn").addEventListener("click", async () => {
    $("ankiConnectBtn").disabled = true;
    try {
      await (await inboxClient()).health();
      ankiStatus("已連線本機 Inbox。");
    } catch (e) {
      ankiStatus(`連線失敗：${e.message}`, true);
    } finally {
      $("ankiConnectBtn").disabled = false;
    }
  });

  $("ankiExportBtn").addEventListener("click", async () => {
    $("ankiExportBtn").disabled = true;
    try {
      const r = await sendToLearnTab({ type: "anki:export" });
      ankiStatus(`已匯出學習包：${r.path}${r.mode === "folder" ? "（直寫資料夾）" : "（下載模式）"}`);
    } catch (e) {
      ankiStatus(`匯出失敗：${e.message}`, true);
    } finally {
      $("ankiExportBtn").disabled = false;
    }
  });

  $("ankiSendBtn").addEventListener("click", async () => {
    $("ankiSendBtn").disabled = true;
    try {
      ankiStatus("讀取目前單元字幕…");
      const pack = await fetchStudyPack();
      const client = await inboxClient();
      const r = await client.submit(pack, { processor: $("ankiProcessor").value });
      ankiStatus(`已送出（${r.status}${r.deduplicated ? "，沿用既有 item" : ""}），等待處理…`);
      pollItem(client, r.itemId, pack);
    } catch (e) {
      ankiStatus(`送出失敗：${e.message}`, true);
    } finally {
      $("ankiSendBtn").disabled = false;
    }
  });

  $("ankiJsonInput").addEventListener("change", async () => {
    const file = $("ankiJsonInput").files?.[0];
    if (!file) return;
    try {
      const pack = await fetchStudyPack();
      const n = adoptPackage(await readCardJsonFile(file), pack);
      ankiStatus(`已載入 ${n} 張卡片，請審核後再同步。`);
    } catch (e) {
      ankiStatus(`匯入失敗：${e.message}`, true);
    } finally {
      $("ankiJsonInput").value = "";
    }
  });

  $("ankiSyncBtn").addEventListener("click", async () => {
    if (!draft) return;
    const pkg = draftPackage(draft);
    const indices = selectedPendingIndices(draft);
    if (!indices.length) return;
    if (!confirm(`即將寫入 Anki deck「Udemy Boost::${pkg.course.title}」共 ${indices.length} 張卡片，確定？`)) return;
    $("ankiSyncBtn").disabled = true;
    ankiStatus("同步中…");
    try {
      const r = await syncCardsToAnki(pkg, { selectedIndices: indices });
      draft = markSyncResults(draft, r.items);
      await saveDraft();
      renderCards();
      ankiStatus(`同步完成 → ${r.deck}：新增 ${r.counts.added}、已存在 ${r.counts.duplicate}、拒絕 ${r.counts.rejected}、失敗 ${r.counts.failed}`, r.counts.rejected + r.counts.failed > 0);
    } catch (e) {
      renderCards();
      ankiStatus(`同步失敗：${e.message}（草稿保留）`, true);
    }
  });

  $("ankiClearBtn").addEventListener("click", async () => {
    if (!draft) return;
    if (!confirm("清除本機卡片草稿？（已同步進 Anki 的卡片不受影響）")) return;
    stopPoll();
    draft = null;
    await saveDraft();
    await chrome.storage.local.remove(ANKI_LAST_KEY);
    draftStoreKey = null;
    renderCards();
    ankiStatus("草稿已清除。");
  });
}

async function init() {
  await initFsUi();
  await initDownloadUi();
  await initLearningUi();
  const opts = await loadOptions();
  for (const [key, prop] of Object.entries(FIELDS)) {
    const el = $(key);
    if (!el) {
      // 少一個元素不該讓後面的欄位全部失效（0.5.0 的 fx* 就是這樣整組失聯）
      console.error("[ub:options] missing control for", key);
      continue;
    }
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
  $("libreGrantBtn").addEventListener("click", () => ensureLibrePermission($("libreUrl").value));
  await initAnkiUi();
  $("clearCache").addEventListener("click", async () => {
    await cache.clear();
    await refreshCacheStats();
  });
  await Promise.all([refreshCacheStats(), refreshChromeStatus()]);
}

init();
