// 字幕軌 locale 選擇。純函式。

export function normalizeLocale(id) {
  if (typeof id !== "string") return "";
  return id.trim().toLowerCase().replace(/-/g, "_");
}

const ZH_PRIORITY = ["zh_tw", "zh_hk", "zh_cn"];
const EN_PRIORITY = ["en_us", "en_gb"];

function pickByPriority(captions, priority, prefix) {
  if (!Array.isArray(captions)) return null;
  const valid = captions.filter((c) => c && typeof c.locale_id === "string");
  for (const want of priority) {
    const hit = valid.find((c) => normalizeLocale(c.locale_id) === want);
    if (hit) return hit;
  }
  // 未知變體退路：完全等於 prefix，或 prefix + "_" 開頭
  const fallback = valid.find((c) => {
    const n = normalizeLocale(c.locale_id);
    return n === prefix || n.startsWith(prefix + "_");
  });
  return fallback ?? null;
}

/** zh_TW > zh_HK > zh_CN > 其他 zh_*；無則 null。 */
export function pickZh(captions) {
  return pickByPriority(captions, ZH_PRIORITY, "zh");
}

/** en_US > en_GB > 其他 en_*；無則 null。 */
export function pickEn(captions) {
  return pickByPriority(captions, EN_PRIORITY, "en");
}
