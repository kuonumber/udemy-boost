// 主流程（ES module，由 content.js 動態載入）。
import { parse as parseVtt } from "./vtt.js";
import { pick, pairText } from "./align.js";
import { pickZh, pickEn } from "./locale.js";
import { parseLectureId, getCourseIdFromPage, fetchCaptionList, fetchVttText, UdemyApiError } from "./udemy-api.js";
import { Overlay } from "./overlay.js";
import { DEFAULT_OPTIONS, loadOptions, saveOptions, onOptionsChanged } from "./options-store.js";
import { convertCues, needsOpenCC, toTW, DICT_VERSION } from "./opencc.js";
import { cacheKey, TranslateError } from "./translate/batch.js";
import { createChromeCache } from "./translate/cache.js";
import { providerOrder, translateWithFallback } from "./translate/fallback.js";
import { createChromeProvider, availability as chromeAvailability, ensureReady as chromeEnsureReady } from "./translate/chrome.js";
import { createLibreProvider } from "./translate/libre.js";
import { fetchCurriculum, buildPlan, parseCourseSlug } from "./download/curriculum.js";
import { safeSegment, pad2 } from "./download/naming.js";
import { Tracker } from "./learning/tracker.js";
import { createLogStore } from "./learning/store.js";
import { buildReport, renderMarkdown } from "./learning/log.js";
import { getToday } from "./learning/tracker.js";
import { Segmenter } from "./focus/segmenter.js";
import { FocusControls } from "./focus/controls.js";
import { fsLinked, courseMeta, lectureMeta, appendSegment, completedSegment, appendNote, exportProgressToFolder, EXT_VERSION } from "./focus/pipeline.js";
import { buildStudyPackData } from "./anki/context.js";
import { renderStudyPack } from "./anki/study-pack.js";

const LOG = "[ub]";
const URL_POLL_MS = 500;
const MAX_RETRY = 3;
const TARGET = "zh-Hant";

let options = { ...DEFAULT_OPTIONS };
let session = null;
let pendingRecall = null; // 影片結束後尚未回答的回想筆記 { lectureId, courseId, title }
const cache = createChromeCache();
const logStore = createLogStore();

function courseTitleFromPage() {
  return document.title.replace(/^Course:\s*/, "").replace(/\s*\|\s*Udemy\s*$/, "").trim();
}

// ---------- 學習歷程 ----------

async function buildProgressMarkdown(courseId) {
  const slug = parseCourseSlug(location.href);
  const title = courseTitleFromPage() || slug;
  const [{ log }, curriculum] = await Promise.all([logStore.get(courseId, title, slug), fetchCurriculum(courseId)]);
  const report = buildReport(curriculum, log, new Date().toISOString());
  return { md: renderMarkdown(report, { timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }), report, title };
}

async function exportProgress(courseId) {
  const { md, title, report } = await buildProgressMarkdown(courseId);
  const path = `Udemy/${safeSegment(title)}/progress.md`;
  const r = await chrome.runtime.sendMessage({ type: "downloadText", path, body: md, mime: "text/markdown" });
  if (!r?.ok) throw new Error(r?.error ?? "download failed");
  return { path, totals: report.totals };
}

/** 資料夾已連結 → Phase 5 直寫（CSV + 分析）；否則 Phase 4 downloads。 */
async function exportAny(courseId) {
  if (await fsLinked()) {
    const title = courseTitleFromPage() || parseCourseSlug(location.href);
    const { log } = await logStore.get(courseId, title, parseCourseSlug(location.href));
    const { path, report } = await exportProgressToFolder({ courseId, courseTitle: title, phase4Log: log });
    return { path, totals: report.totals, mode: "folder" };
  }
  return { ...(await exportProgress(courseId)), mode: "downloads" };
}

// ---------- GPT 學習包（只含目前單元） ----------

async function currentStudyPack() {
  const courseId = getCourseIdFromPage();
  if (!courseId) throw new Error("找不到 courseId（請在課程播放頁開啟）");
  const lectureId = parseLectureId(location.href);
  if (!lectureId) throw new Error("目前網址不是課程單元頁");
  const tracks = session?.tracks;
  if (!tracks || (tracks.en.length === 0 && tracks.zh.length === 0)) throw new Error("目前單元字幕還沒載入完成（或這一講沒有字幕）");
  const meta = await courseMeta(courseId);
  return buildStudyPackData({
    courseId,
    courseTitle: courseTitleFromPage(),
    courseSlug: parseCourseSlug(location.href),
    lectureId,
    pageUrl: location.href,
    curriculum: meta.curriculum,
    tracks,
  });
}

/** Udemy/<課程>/<章>/<單元>/study-pack.md；資料夾已連結就直寫，否則走下載。 */
async function exportStudyPack() {
  const pack = await currentStudyPack();
  const md = renderStudyPack({ course: pack.course, unit: pack.unit, enCues: pack.subtitles.en, zhCues: pack.subtitles.zh });
  const meta = await courseMeta(getCourseIdFromPage());
  const m = lectureMeta(meta, pack.unit.id);
  const rel = `${safeSegment(courseTitleFromPage() || pack.course.slug)}/${pad2(m.chapterIndex)}. ${safeSegment(m.chapterTitle)}/${pad2(m.lectureIndex)}. ${safeSegment(m.title)}/study-pack.md`;
  const folder = await fsLinked();
  const r = folder
    ? await chrome.runtime.sendMessage({ type: "fs:write", path: rel, text: md })
    : await chrome.runtime.sendMessage({ type: "downloadText", path: `Udemy/${rel}`, body: md, mime: "text/markdown" });
  if (!r?.ok) throw new Error(r?.error ?? "寫入學習包失敗");
  return { path: `Udemy/${rel}`, mode: folder ? "folder" : "downloads" };
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function withRetry(fn, label) {
  let lastErr;
  for (let i = 0; i < MAX_RETRY; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (e instanceof UdemyApiError && (e.status === 401 || e.status === 403)) break;
      console.warn(LOG, label, `attempt ${i + 1} failed`, e);
      await sleep(500 * 2 ** i);
    }
  }
  throw lastErr;
}

function buildProviders() {
  const map = {
    chrome: () => createChromeProvider(),
    libre: () => {
      try {
        return createLibreProvider({ baseUrl: options.libreUrl, apiKey: options.libreApiKey, toTW });
      } catch (e) {
        console.warn(LOG, "libre provider misconfigured", e);
        return null;
      }
    },
  };
  return providerOrder(options.provider).map((id) => map[id]()).filter(Boolean);
}

class Session {
  constructor(lectureId) {
    this.lectureId = lectureId;
    this.tracks = null; // { en: Cue[], zh: Cue[] }
    this.video = null;
    this.overlay = null;
    this.raf = 0;
    this.dead = false;
    this.mo = null;
    this.ac = new AbortController();
    this.tracker = null;
    this.segmenter = null;
    this.controls = null;
    this.courseId = null;
    this.meta = null; // curriculum 中繼資料（章 / 講）
    this.lastPos = null; // 上一個 timeupdate 的位置，seeked 時用來判斷回看
    this.onVideoEvent = () => this.tick();
    this.onVideoTime = () => (this.lastPos = this.video?.currentTime ?? null);
    this.onVideoSeeked = () => {
      const to = this.video?.currentTime;
      if (this.segmenter && typeof this.lastPos === "number") this.segmenter.onSeek(this.lastPos, to);
      this.lastPos = to;
    };
    this.onVideoEnded = () => {
      this.tracker?.onEnded();
      this.recallPrompt().catch((e) => console.warn(LOG, "recall prompt failed", e));
    };
    this.status = "";
    this.action = null; // { label, fn }
  }

  setStatus(s) {
    this.status = s ?? "";
    this.overlay?.setStatus(this.status);
  }

  setAction(label, fn) {
    this.action = label ? { label, fn } : null;
    this.overlay?.setAction(label, fn);
  }

  async start() {
    const courseId = getCourseIdFromPage();
    if (!courseId) {
      console.warn(LOG, "courseId not found on page");
      return;
    }
    this.courseId = courseId;
    this.attachVideoWatcher();
    this.startTracker(courseId);
    try {
      await this.load(courseId);
    } catch (e) {
      if (this.dead) return;
      console.error(LOG, "load failed", e);
      this.setStatus(
        e instanceof UdemyApiError && (e.status === 401 || e.status === 403)
          ? "無法取得字幕（未登入或未購買）"
          : `字幕載入失敗：${e?.message ?? e}`,
      );
    }
    this.tick();
  }

  async load(courseId) {
    const caps = await withRetry(() => fetchCaptionList(courseId, this.lectureId), "captions list");
    if (this.dead) return;
    const enCap = pickEn(caps);
    const zhCap = pickZh(caps);
    const assetId = caps[0]?.asset_id ?? this.lectureId;

    const [enTxt, zhTxt] = await Promise.all([
      enCap ? withRetry(() => fetchVttText(enCap.url), "en vtt") : null,
      zhCap ? withRetry(() => fetchVttText(zhCap.url), "zh vtt") : null,
    ]);
    if (this.dead) return;
    const en = enTxt ? parseVtt(enTxt) : [];
    let zh = zhTxt ? parseVtt(zhTxt) : [];
    this.tracks = { en, zh };
    this.tick(); // 先把英文（與原始中文）顯示出來

    if (zhCap) {
      let status = zhCap.locale_id.toLowerCase().includes("tw") ? "" : `中文軌 ${zhCap.locale_id}`;
      if (options.opencc && needsOpenCC(zhCap.locale_id)) {
        try {
          zh = await convertCues(zh);
          status = `${status} → 繁體`.trim();
        } catch (e) {
          // 轉繁失敗只影響中文字形，不要把整個字幕標成失敗
          console.error(LOG, "opencc failed", e);
          status = `${status}（轉繁失敗：${e.message}）`;
        }
      }
      if (this.dead) return;
      this.tracks = { en, zh };
      this.setStatus(status);
      console.info(LOG, `lecture ${this.lectureId}: en=${enCap?.locale_id} (${en.length}), zh=${zhCap.locale_id} (${zh.length})`);
      return;
    }

    console.info(LOG, `lecture ${this.lectureId}: en=${enCap?.locale_id} (${en.length}), no zh track`);
    if (!enCap || en.length === 0) {
      this.setStatus("無英文/中文字幕軌");
      return;
    }
    await this.translate(en, assetId, enCap.locale_id);
  }

  /** 無中文軌：快取 → provider（含 fallback）。 */
  async translate(en, assetId, enLocale) {
    const order = providerOrder(options.provider);
    if (order.length === 0) {
      this.setStatus("無中文軌");
      return;
    }
    // 快取：先找使用者選的 provider，再找其他（fallback 產生的）
    for (const pid of order) {
      const key = await cacheKey({ assetId, locale: enLocale, provider: pid, target: TARGET, dictVersion: DICT_VERSION });
      const hit = await cache.get(key);
      if (hit) {
        if (this.dead) return;
        this.tracks = { en, zh: hit };
        this.setStatus(`機翻 (${pid}，快取)`);
        return;
      }
    }

    const run = async () => {
      this.setAction(null);
      this.setStatus("翻譯中…");
      try {
        const r = await translateWithFallback(en, buildProviders(), {
          signal: this.ac.signal,
          onProgress: (d, t) => this.setStatus(`翻譯中 ${d}/${t}`),
        });
        if (this.dead) return;
        this.tracks = { en, zh: r.cues };
        const note = r.failed.length ? `，${r.failed.map((f) => f.id).join("/")} 失敗已切換` : "";
        this.setStatus(`機翻 (${r.providerId})${note}`);
        const key = await cacheKey({ assetId, locale: enLocale, provider: r.providerId, target: TARGET, dictVersion: DICT_VERSION });
        await cache.set(key, r.cues);
      } catch (e) {
        if (this.dead || e?.name === "AbortError") return;
        console.error(LOG, "translate failed", e);
        const detail = e instanceof TranslateError && e.failed ? e.failed.map((f) => `${f.id}: ${f.error.message}`).join("; ") : e.message;
        this.setStatus(`翻譯失敗：${detail}`);
        await this.offerChromeDownload(run);
      }
    };
    await run();
  }

  /** Chrome 模型還沒下載時，給一顆按鈕（create() 需要 user activation）。 */
  async offerChromeDownload(rerun) {
    if (!providerOrder(options.provider).includes("chrome")) return;
    const st = await chromeAvailability();
    if (st !== "downloadable" && st !== "downloading") return;
    this.setAction("下載 Chrome 翻譯模型", async () => {
      this.setAction(null);
      try {
        await chromeEnsureReady((l, t) => this.setStatus(`下載翻譯模型 ${Math.round((l / t) * 100)}%`));
        await rerun();
      } catch (e) {
        console.error(LOG, "model download failed", e);
        this.setStatus(`模型下載失敗：${e.message}`);
      }
    });
  }

  startTracker(courseId) {
    if (!options.lpEnabled) return;
    this.controls = new FocusControls({ getVideo: () => this.video, overlay: this.overlay, options, getToday });
    // 章 / 講中繼資料非同步載入；載到之前先用空值建 segmenter，之後補
    this.segmenter = new Segmenter({ lectureId: Number(this.lectureId), chapterIndex: 0, lectureIndex: 0, title: "", extVersion: EXT_VERSION });
    courseMeta(courseId)
      .then((meta) => {
        if (this.dead) return;
        this.meta = meta;
        const m = lectureMeta(meta, this.lectureId);
        this.segmenter.meta = { lectureId: Number(this.lectureId), chapterIndex: m.chapterIndex, lectureIndex: m.lectureIndex, title: m.title, extVersion: EXT_VERSION };
      })
      .catch((e) => console.warn(LOG, "curriculum meta failed", e));
    this.tracker = new Tracker({
      courseId,
      lectureId: this.lectureId,
      courseTitle: courseTitleFromPage(),
      slug: parseCourseSlug(location.href),
      store: logStore,
      getVideo: () => this.video,
      idleLimitMs: options.lpIdleMinutes * 60_000,
      requireFocus: options.lpRequireFocus,
      onSample: (sample) => this.onSample(sample),
      onCompleted: (ids) => {
        console.info(LOG, "lecture completed", ids);
        this.writeCompleted(ids).catch((e) => console.warn(LOG, "write completed failed", e));
        if (options.lpAutoExport) exportAny(courseId).catch((e) => console.warn(LOG, "auto export failed", e));
      },
    });
    this.tracker.start().catch((e) => console.warn(LOG, "tracker start failed", e));
  }

  /** 每秒：餵介入層與 segmenter；段結束就追加到 CSV。 */
  onSample(sample) {
    if (this.dead) return;
    this.controls?.onSample(sample).catch((e) => console.warn(LOG, "controls", e));
    if (!this.segmenter) return;
    const v = sample.video;
    const seg = this.segmenter.tick({
      now: sample.now.toISOString(), counting: sample.counting, reason: sample.reason,
      pos: v?.currentTime, rate: v?.playbackRate, durationS: v?.duration,
    });
    if (seg) this.writeSegment(seg);
  }

  writeSegment(seg) {
    appendSegment(courseTitleFromPage(), seg)
      .then((r) => {
        if (r?.queued) console.info(LOG, `segment queued (${r.code ?? "no folder"}), queue size ${r.size}`);
      })
      .catch((e) => console.warn(LOG, "append segment failed", e));
  }

  async writeCompleted(ids) {
    if (!this.meta) this.meta = await courseMeta(this.courseId).catch(() => null);
    if (!this.meta) return;
    const now = new Date().toISOString();
    for (const id of ids) await appendSegment(courseTitleFromPage(), completedSegment(this.meta, id, now));
  }

  /** 影片結束 → 回想一句話 → notes.md。Udemy 自動跳下一講時，輸入框由新 Session 接手（pendingRecall）。 */
  async recallPrompt() {
    if (!options.fxRecallPrompt || this.promptShown) return;
    this.promptShown = true;
    pendingRecall = { lectureId: this.lectureId, courseId: this.courseId, title: courseTitleFromPage() };
    await this.askPendingRecall();
  }

  async askPendingRecall() {
    const ctx = pendingRecall;
    if (!ctx || !this.overlay) return;
    const text = await this.overlay.showPrompt(`「${lectureMeta(this.meta ?? (await courseMeta(ctx.courseId).catch(() => null)) ?? { byLecture: new Map() }, ctx.lectureId).title || "上一講"}」的重點（一句話）— Ctrl+Enter 送出 / Esc 略過`);
    if (pendingRecall !== ctx) return; // 已被別的 Session 接手
    pendingRecall = null;
    if (!text) return;
    const meta = await courseMeta(ctx.courseId).catch(() => null);
    if (!meta) return;
    const r = await appendNote(ctx.title, meta, ctx.lectureId, text);
    if (r?.queued) this.overlay?.setToast("筆記已暫存（資料夾未連結）", 4000);
    else this.overlay?.setToast("筆記已寫入 notes.md", 3000);
  }

  /** video 元素會被播放器重建（換畫質/全螢幕），用 MutationObserver 追。 */
  attachVideoWatcher() {
    const bind = () => {
      const v = document.querySelector("video");
      if (v === this.video) return;
      this.unbindVideo();
      if (!v) return;
      this.video = v;
      const container = v.closest('[class*="video-player-module--video-container"]') ?? v.parentElement;
      this.overlay = new Overlay(container, {
        onPositionChange: (pos) => saveOptions({ offsetX: pos.offsetX, bottomOffset: pos.bottom }),
      });
      this.overlay.applyOptions(options);
      this.overlay.setStatus(this.status);
      if (this.action) this.overlay.setAction(this.action.label, this.action.fn);
      this.controls?.setOverlay(this.overlay);
      if (pendingRecall) this.askPendingRecall().catch((e) => console.warn(LOG, "recall resume failed", e));
      for (const ev of ["timeupdate", "seeked", "play", "pause", "loadedmetadata"]) v.addEventListener(ev, this.onVideoEvent);
      v.addEventListener("timeupdate", this.onVideoTime);
      v.addEventListener("seeked", this.onVideoSeeked);
      v.addEventListener("ended", this.onVideoEnded);
      this.tick();
    };
    bind();
    this.mo = new MutationObserver(() => bind());
    this.mo.observe(document.body, { childList: true, subtree: true });
  }

  unbindVideo() {
    if (this.video) {
      for (const ev of ["timeupdate", "seeked", "play", "pause", "loadedmetadata"]) this.video.removeEventListener(ev, this.onVideoEvent);
      this.video.removeEventListener("timeupdate", this.onVideoTime);
      this.video.removeEventListener("seeked", this.onVideoSeeked);
      this.video.removeEventListener("ended", this.onVideoEnded);
    }
    this.video = null;
    this.overlay?.destroy();
    this.overlay = null;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  tick() {
    if (this.dead || !this.video || !this.overlay || !this.tracks) return;
    const t = this.video.currentTime;
    this.overlay.render(pairText(pick(this.tracks.en, t), pick(this.tracks.zh, t)));
    cancelAnimationFrame(this.raf);
    if (!this.video.paused && !this.video.ended) this.raf = requestAnimationFrame(() => this.tick());
  }

  applyOptions() {
    this.overlay?.applyOptions(options);
    this.controls?.setOptions(options);
  }

  destroy() {
    this.dead = true;
    this.ac.abort();
    this.mo?.disconnect();
    // 換講次 / 關頁：正在計的段先關掉寫出去
    const seg = this.segmenter?.close(new Date().toISOString(), "lecture_switch");
    if (seg) this.writeSegment(seg);
    this.segmenter = null;
    this.controls?.destroy();
    this.controls = null;
    this.tracker?.destroy();
    this.tracker = null;
    this.unbindVideo();
  }
}

function switchLecture(lectureId) {
  session?.destroy();
  session = null;
  if (!lectureId || !options.enabled) return;
  session = new Session(lectureId);
  session.start();
}

// 這些選項變了要重載講次（影響字幕內容），其餘只重繪
const RELOAD_KEYS = ["enabled", "opencc", "provider", "libreUrl", "libreApiKey", "lpEnabled", "lpIdleMinutes", "lpRequireFocus"];
// fx* 選項不重載，透過 applyOptions → controls.setOptions 即時生效

async function boot() {
  options = await loadOptions();
  onOptionsChanged((next) => {
    const needReload = RELOAD_KEYS.some((k) => options[k] !== next[k]);
    options = next;
    if (needReload) switchLecture(parseLectureId(location.href));
    else session?.applyOptions();
  });

  let lastHref = "";
  const check = () => {
    if (location.href === lastHref) return;
    const prevLecture = parseLectureId(lastHref);
    lastHref = location.href;
    const cur = parseLectureId(lastHref);
    if (cur !== prevLecture) switchLecture(cur);
  };
  window.addEventListener("pagehide", () => {
    const seg = session?.segmenter?.close(new Date().toISOString(), "page_hide");
    if (seg) session.writeSegment(seg);
  });
  check();
  setInterval(check, URL_POLL_MS); // Udemy 是 SPA；isolated world 攔不到頁面的 pushState，輪詢最穩
  window.addEventListener("popstate", check);
}

// popup → content：需要同源 cookie 的工作都在這裡做
const CONTENT_HANDLERS = {
  // 設定頁用它確認這個分頁真的有 content script 且 main.js 已載入完成
  async ping() {
    return { ok: true, version: EXT_VERSION, lectureId: parseLectureId(location.href) };
  },
  async scan() {
    const courseId = getCourseIdFromPage();
    if (!courseId) throw new Error("找不到 courseId（請在課程播放頁開啟）");
    const slug = parseCourseSlug(location.href);
    const results = await fetchCurriculum(courseId);
    const title = courseTitleFromPage() || slug;
    return { ok: true, plan: buildPlan(results, { slug: slug ?? String(courseId), title }) };
  },
  async "lp:summary"() {
    const courseId = getCourseIdFromPage();
    if (!courseId) throw new Error("找不到 courseId");
    await session?.tracker?.flush();
    const { report, title } = await buildProgressMarkdown(courseId);
    return { ok: true, summary: { title, ...report.totals, lastSyncAt: report.lastSyncAt } };
  },
  async "lp:export"() {
    const courseId = getCourseIdFromPage();
    if (!courseId) throw new Error("找不到 courseId");
    await session?.tracker?.flush();
    return { ok: true, ...(await exportAny(courseId)) };
  },
  async "anki:pack"() {
    return { ok: true, pack: await currentStudyPack() };
  },
  async "anki:export"() {
    return { ok: true, ...(await exportStudyPack()) };
  },
  async "lp:clear"() {
    const courseId = getCourseIdFromPage();
    if (!courseId) throw new Error("找不到 courseId");
    await logStore.clear(courseId);
    switchLecture(parseLectureId(location.href)); // 重建 tracker，讓它重新以「首次同步」建檔
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const h = CONTENT_HANDLERS[msg?.type];
  if (!h) return false;
  h().then(sendResponse, (e) => sendResponse({ ok: false, error: e?.message ?? String(e) }));
  return true;
});

boot().catch((e) => console.error(LOG, "boot failed", e));
