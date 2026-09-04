// OpenCC 簡→台灣繁體（含用語）。vendor 的 cn2t build lazy 載入（1.1 MB，只在需要時載）。

export const DICT_VERSION = "opencc-js@1.4.2-cn2t";

let converterPromise = null;

async function getConverter() {
  if (!converterPromise) {
    converterPromise = import("../vendor/opencc-cn2t.esm.js").then((m) => m.Converter({ from: "cn", to: "twp" }));
  }
  return converterPromise;
}

/** 簡體 → 台灣繁體（s2twp）。非字串丟 TypeError。 */
export async function toTW(text) {
  if (typeof text !== "string") throw new TypeError("toTW expects a string");
  if (text === "") return "";
  const convert = await getConverter();
  return convert(text);
}

/** 回新陣列，只換 text。 */
export async function convertCues(cues) {
  if (cues.length === 0) return [];
  const convert = await getConverter();
  return cues.map((c) => ({ ...c, text: convert(c.text) }));
}

/** zh_TW 軌不轉（避免 twp 用語轉換誤傷原本正確的台灣用語），其他中文軌都轉。 */
export function needsOpenCC(localeId) {
  if (typeof localeId !== "string") return false;
  const n = localeId.trim().toLowerCase().replace(/-/g, "_");
  return n.startsWith("zh") && n !== "zh_tw";
}
