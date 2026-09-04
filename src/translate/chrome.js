// Chrome 內建 Translator API（Chrome 138+）。
// 文件：https://developer.chrome.com/docs/ai/translator-api
// - availability(): 'unavailable' | 'downloadable' | 'downloading' | 'available'
// - 'downloadable' 時 create() 需要 user activation → 由 UI 提供按鈕呼叫 ensureReady()。
// - 同一 translator 一次只能跑一個 translate()（文件明載），這裡序列化逐句翻。
import { TranslateError } from "./batch.js";

const OPTS = { sourceLanguage: "en", targetLanguage: "zh-Hant" };

let translatorPromise = null;

export function hasTranslatorApi() {
  return typeof globalThis.Translator !== "undefined" && typeof globalThis.Translator.availability === "function";
}

export async function availability() {
  if (!hasTranslatorApi()) return "unavailable";
  try {
    return await globalThis.Translator.availability(OPTS);
  } catch {
    return "unavailable";
  }
}

/**
 * 建立 translator（會觸發模型下載）。呼叫端若在 'downloadable' 狀態需在 click handler 內呼叫。
 * @param {(loaded:number,total:number)=>void} [onDownload]
 */
export async function ensureReady(onDownload) {
  if (!translatorPromise) {
    translatorPromise = globalThis.Translator.create({
      ...OPTS,
      monitor(m) {
        m.addEventListener("downloadprogress", (e) => onDownload?.(e.loaded, e.total ?? 1));
      },
    }).catch((e) => {
      translatorPromise = null;
      throw e;
    });
  }
  return translatorPromise;
}

export function createChromeProvider() {
  return {
    id: "chrome",
    /** 只有模型已在本機才算 available；downloadable 需使用者點擊，由 UI 另外處理。 */
    async available() {
      return (await availability()) === "available" || translatorPromise !== null;
    },
    async translateBatch(texts, { signal, onProgress } = {}) {
      let tr;
      try {
        tr = await ensureReady();
      } catch (e) {
        throw new TranslateError("chrome", e);
      }
      const out = [];
      for (let i = 0; i < texts.length; i++) {
        if (signal?.aborted) {
          const e = new Error("aborted");
          e.name = "AbortError";
          throw e;
        }
        try {
          out.push(await tr.translate(texts[i].replace(/\s*\n\s*/g, " ")));
        } catch (e) {
          throw new TranslateError("chrome", e);
        }
        onProgress?.(i + 1, texts.length);
      }
      return out;
    },
  };
}
