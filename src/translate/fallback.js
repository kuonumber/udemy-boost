// provider 順序與自動 fallback。純邏輯，provider 以介面注入。
import { TranslateError } from "./batch.js";

const ALL = ["chrome", "libre"];

/** 使用者選的 provider 排第一，其餘依序補在後面；none / 未知 → 空。 */
export function providerOrder(preferred) {
  if (!ALL.includes(preferred)) return [];
  return [preferred, ...ALL.filter((p) => p !== preferred)];
}

function abortError() {
  const e = new Error("aborted");
  e.name = "AbortError";
  return e;
}

/**
 * @param {{start,end,text}[]} cues
 * @param {{id:string, available():Promise<boolean>, translateBatch(texts:string[], opts):Promise<string[]>}[]} providers
 * @returns {Promise<{cues, providerId, failed:{id,error}[]}>}
 */
export async function translateWithFallback(cues, providers, { signal, onProgress } = {}) {
  if (signal?.aborted) throw abortError();
  if (cues.length === 0) return { cues: [], providerId: null, failed: [] };
  if (providers.length === 0) throw new TranslateError("fallback", "no provider configured", []);

  const failed = [];
  const texts = cues.map((c) => c.text);
  for (const p of providers) {
    if (signal?.aborted) throw abortError();
    try {
      if (!(await p.available())) {
        failed.push({ id: p.id, error: new Error("unavailable") });
        continue;
      }
      const out = await p.translateBatch(texts, { signal, onProgress });
      if (!Array.isArray(out) || out.length !== texts.length) {
        throw new TranslateError(p.id, `returned ${out?.length} items for ${texts.length}`);
      }
      return { cues: cues.map((c, i) => ({ ...c, text: out[i] })), providerId: p.id, failed };
    } catch (e) {
      if (e?.name === "AbortError") throw e;
      failed.push({ id: p.id, error: e });
    }
  }
  throw new TranslateError("fallback", `all providers failed: ${failed.map((f) => `${f.id}: ${f.error.message}`).join("; ")}`, failed);
}
