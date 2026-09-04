// Udemy 頁面/API 存取。純函式部分（parse*/build*）可在 node 測試；fetch 部分只在瀏覽器跑。
// 注意：此 API 無公開文件，欄位名為 2026-09-04 在 www.udemy.com 實測結果。

const ID_RE = /^\d+$/;

/** learn 頁 URL → lecture id 字串；非 lecture 頁回 null。 */
export function parseLectureId(url) {
  if (typeof url !== "string") return null;
  const m = /\/learn\/lecture\/(\d+)(?:[/?#]|$)/.exec(url);
  return m ? m[1] : null;
}

/** `.ud-app-loader[data-module-args]` 的 JSON 字串 → courseId 字串；失敗回 null。 */
export function parseCourseIdFromModuleArgs(json) {
  if (typeof json !== "string") return null;
  try {
    const v = JSON.parse(json)?.courseId;
    const s = String(v ?? "");
    return ID_RE.test(s) && Number(s) > 0 ? s : null;
  } catch {
    return null;
  }
}

export function buildCaptionsUrl(courseId, lectureId) {
  if (!ID_RE.test(String(courseId)) || !ID_RE.test(String(lectureId))) {
    throw new RangeError("courseId/lectureId must be numeric");
  }
  return `/api-2.0/users/me/subscribed-courses/${courseId}/lectures/${lectureId}/?fields[lecture]=asset&fields[asset]=captions`;
}

// ---------- 以下需要瀏覽器 ----------

export function getCourseIdFromPage(doc = document) {
  const el = doc.querySelector(".ud-app-loader[data-module-args]");
  return el ? parseCourseIdFromModuleArgs(el.dataset.moduleArgs) : null;
}

export class UdemyApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "UdemyApiError";
    this.status = status;
  }
}

/**
 * @returns {Promise<{locale_id:string,url:string,source?:string}[]>}
 */
export async function fetchCaptionList(courseId, lectureId) {
  const res = await fetch(buildCaptionsUrl(courseId, lectureId), { credentials: "same-origin" });
  if (!res.ok) throw new UdemyApiError(`captions API ${res.status}`, res.status);
  const json = await res.json();
  const caps = json?.asset?.captions;
  return Array.isArray(caps) ? caps : [];
}

export async function fetchVttText(url) {
  const res = await fetch(url, { credentials: "omit" });
  if (!res.ok) throw new UdemyApiError(`vtt ${res.status}`, res.status);
  return res.text();
}
