// LibreTranslate provider。純函式（pickTarget / buildTranslateBody / normalizeBaseUrl / isLocalhost）可測；
// fetch 部分只在瀏覽器跑。
import { pack, unpack, TranslateError } from "./batch.js";

const TARGET_PRIORITY = ["zh-hant", "zt", "zh-tw"]; // 已是繁體
const CHUNK_CHARS = 2000;
const CONCURRENCY = 3;
const RETRY = 2;

/**
 * 從 GET /languages 結果挑繁中 target。回 { code, needsOpenCC } 或 null。
 * 新版每個語言有 targets[]；舊版沒有，就用所有 code 推斷。
 */
export function pickTarget(languages) {
  if (!Array.isArray(languages)) return null;
  const en = languages.find((l) => l && typeof l.code === "string" && l.code.toLowerCase() === "en");
  if (!en) return null;
  const candidates = Array.isArray(en.targets) ? en.targets : languages.map((l) => l?.code).filter((c) => typeof c === "string");
  const lower = candidates.map((c) => c.toLowerCase());
  for (const want of TARGET_PRIORITY) {
    const i = lower.indexOf(want);
    if (i !== -1) return { code: candidates[i], needsOpenCC: false };
  }
  const i = lower.indexOf("zh");
  if (i !== -1) return { code: candidates[i], needsOpenCC: true };
  return null;
}

export function buildTranslateBody(texts, target, apiKey) {
  if (!Array.isArray(texts) || texts.length === 0) throw new RangeError("texts must be non-empty");
  const body = { q: texts, source: "en", target, format: "text" };
  if (apiKey) body.api_key = apiKey;
  return body;
}

export function normalizeBaseUrl(url) {
  if (typeof url !== "string" || url.trim() === "") throw new TypeError("libreUrl is empty");
  let u = url.trim();
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(u)) u = "http://" + u;
  const parsed = new URL(u);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new TypeError("libreUrl must be http(s)");
  return u.replace(/\/+$/, "");
}

export function isLocalhost(url) {
  const h = new URL(url).hostname;
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/** 建立 provider。toTW 注入以免在 node 測試時載 1.1 MB 字典。 */
export function createLibreProvider({ baseUrl, apiKey = "", toTW }) {
  const base = normalizeBaseUrl(baseUrl);
  let targetPromise = null;

  async function resolveTarget() {
    if (!targetPromise) {
      targetPromise = (async () => {
        const res = await fetch(`${base}/languages`, { signal: AbortSignal.timeout(5000) });
        if (!res.ok) throw new TranslateError("libre", `GET /languages ${res.status}`);
        const t = pickTarget(await res.json());
        if (!t) throw new TranslateError("libre", "server has no Chinese target for en");
        return t;
      })().catch((e) => {
        targetPromise = null; // 下次再試
        throw e;
      });
    }
    return targetPromise;
  }

  async function postChunk(texts, target, signal) {
    let lastErr;
    for (let attempt = 0; attempt <= RETRY; attempt++) {
      try {
        const res = await fetch(`${base}/translate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildTranslateBody(texts, target, apiKey)),
          signal,
        });
        if (res.status === 400 && texts.length > 1) {
          // 舊版不吃陣列 q → 逐句
          const out = [];
          for (const t of texts) out.push((await postChunk([t], target, signal))[0]);
          return out;
        }
        if (!res.ok) throw new TranslateError("libre", `POST /translate ${res.status}`);
        const json = await res.json();
        const tt = json?.translatedText;
        const arr = Array.isArray(tt) ? tt : typeof tt === "string" ? [tt] : null;
        if (!arr || arr.length !== texts.length) throw new TranslateError("libre", "unexpected translatedText shape");
        return arr;
      } catch (e) {
        if (e?.name === "AbortError") throw e;
        lastErr = e;
        await new Promise((r) => setTimeout(r, 400 * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  return {
    id: "libre",
    async available() {
      try {
        await resolveTarget();
        return true;
      } catch {
        return false;
      }
    },
    async translateBatch(texts, { signal, onProgress } = {}) {
      const target = await resolveTarget();
      const cues = texts.map((text) => ({ text }));
      const { chunks, index } = pack(cues, CHUNK_CHARS);
      const results = new Array(chunks.length);
      let done = 0;
      let next = 0;
      const worker = async () => {
        while (next < chunks.length) {
          const i = next++;
          results[i] = await postChunk(chunks[i], target.code, signal);
          done += chunks[i].length;
          onProgress?.(done, texts.length);
        }
      };
      await Promise.all(Array.from({ length: Math.min(CONCURRENCY, chunks.length) }, worker));
      let out = unpack(results, index, texts.length);
      if (target.needsOpenCC && toTW) out = await Promise.all(out.map((s) => toTW(s)));
      return out;
    },
  };
}
