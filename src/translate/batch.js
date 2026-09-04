// cue 分塊 / 還原 / 快取 key。純函式。

export class TranslateError extends Error {
  /**
   * @param {string} provider
   * @param {Error|string} cause
   * @param {{id:string,error:Error}[]} [failed] fallback 全失敗時每個 provider 的錯誤
   */
  constructor(provider, cause, failed) {
    super(`[${provider}] ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = "TranslateError";
    this.provider = provider;
    this.cause = cause;
    if (failed) this.failed = failed;
  }
}

/**
 * 把 cue 文字依序分塊，每塊總字元 ≤ maxChars；單一 cue 超長時獨立成塊。
 * @returns {{chunks:string[][], index:number[][]}}
 */
export function pack(cues, maxChars) {
  if (!Array.isArray(cues)) throw new TypeError("cues must be an array");
  if (typeof maxChars !== "number" || !Number.isFinite(maxChars) || maxChars <= 0) throw new RangeError("maxChars must be > 0");
  const chunks = [];
  const index = [];
  let cur = [];
  let curIdx = [];
  let curLen = 0;
  for (let i = 0; i < cues.length; i++) {
    const text = cues[i].text.replace(/\s*\n\s*/g, " ");
    if (cur.length > 0 && curLen + text.length > maxChars) {
      chunks.push(cur);
      index.push(curIdx);
      cur = [];
      curIdx = [];
      curLen = 0;
    }
    cur.push(text);
    curIdx.push(i);
    curLen += text.length;
  }
  if (cur.length > 0) {
    chunks.push(cur);
    index.push(curIdx);
  }
  return { chunks, index };
}

/** 依 index 還原；任何長度不符都丟 TranslateError（寧可整批失敗，不要錯位）。 */
export function unpack(chunksOut, index, total) {
  if (chunksOut.length !== index.length) throw new TranslateError("unpack", `chunk count ${chunksOut.length} != ${index.length}`);
  const out = new Array(total);
  let filled = 0;
  for (let c = 0; c < index.length; c++) {
    if (chunksOut[c].length !== index[c].length) {
      throw new TranslateError("unpack", `chunk ${c} length ${chunksOut[c].length} != ${index[c].length}`);
    }
    for (let j = 0; j < index[c].length; j++) {
      out[index[c][j]] = chunksOut[c][j];
      filled++;
    }
  }
  if (filled !== total) throw new TranslateError("unpack", `filled ${filled} != total ${total}`);
  return out;
}

async function sha256Hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** 快取 key：t:<sha256 前 32 hex>。 */
export async function cacheKey(parts) {
  if (!parts || typeof parts !== "object") throw new TypeError("cacheKey expects an object");
  const { assetId, locale, provider, target, dictVersion } = parts;
  for (const [k, v] of Object.entries({ assetId, locale, provider, target, dictVersion })) {
    if (v === undefined || v === null || v === "") throw new TypeError(`cacheKey missing ${k}`);
  }
  const hex = await sha256Hex([assetId, locale, provider, target, dictVersion].join("|"));
  return `t:${hex.slice(0, 32)}`;
}
