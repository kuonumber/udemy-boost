// 依 currentTime 找 cue。純函式。

/**
 * 回傳 start <= t < end 的 cue；重疊時取 start 最大者；無則 null。
 * cues 必須依 start 排序（vtt.parse 已保證）。
 */
export function pick(cues, t) {
  if (!Array.isArray(cues) || cues.length === 0) return null;
  if (typeof t !== "number" || !Number.isFinite(t) || t < 0) return null;

  // binary search：最後一個 start <= t 的索引
  let lo = 0;
  let hi = cues.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  // 從 idx 往前掃，找第一個仍覆蓋 t 的（重疊 cue 中 start 最大者）。
  // 一般字幕重疊很少，往前掃幾步就會超出範圍；加上限避免病態資料退化成 O(n)。
  for (let i = idx, steps = 0; i >= 0 && steps < 64; i--, steps++) {
    const c = cues[i];
    if (c.start <= t && t < c.end) return c;
  }
  return null;
}

/** 兩軌各自獨立查表後組成顯示文字；缺邊給空字串。 */
export function pairText(en, zh) {
  return { en: en?.text ?? "", zh: zh?.text ?? "" };
}
