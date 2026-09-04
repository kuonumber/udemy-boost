// curriculum → 下載計畫。buildPlan / curriculumUrl 為純函式；fetchCurriculum 只在瀏覽器跑。
// API 欄位為 2026-09-04 實測（見 docs/specs/phase3-download-resources.md），非公開文件。
import { safeSegment, pad2, uniquePaths } from "./naming.js";

const ID_RE = /^\d+$/;
const FIELDS =
  "fields[lecture]=title,object_index,supplementary_assets&fields[chapter]=title,object_index" +
  "&fields[asset]=title,filename,asset_type,file_size,download_urls,external_url";

export function curriculumUrl(courseId, pageSize = 1400) {
  if (!ID_RE.test(String(courseId))) throw new RangeError("courseId must be numeric");
  return `/api-2.0/courses/${courseId}/subscriber-curriculum-items/?page_size=${pageSize}&${FIELDS}`;
}

function fileUrl(asset) {
  const f = asset?.download_urls?.File;
  return Array.isArray(f) && f[0] && typeof f[0].file === "string" && f[0].file ? f[0].file : null;
}

/**
 * @param {object[]} results curriculum items（chapter / lecture / quiz / …）
 * @param {{slug:string,title?:string}} course
 */
export function buildPlan(results, course) {
  if (!Array.isArray(results)) throw new TypeError("results must be an array");
  if (!course || typeof course.slug !== "string" || !course.slug) throw new TypeError("course.slug required");

  // 資料夾用課程名稱（使用者要求），沒有 title 才退 slug
  const root = `Udemy/${safeSegment(String(course.title?.trim() || course.slug))}`;
  // 實測：API 回傳順序就是課程大綱順序；chapter 與 lecture 的 object_index 是各自獨立的序號（c1, l1..l9, c2, l10…），
  // 不能拿來混合排序，否則講次會被歸到錯的章。
  const sorted = results.filter((r) => r && typeof r === "object");

  const items = [];
  const links = [];
  const skipped = [];
  const seenAsset = new Set();
  let chapterDir = "00. (no section)";
  let totalBytes = 0;
  let unknownSizeCount = 0;

  for (const it of sorted) {
    if (it._class === "chapter") {
      chapterDir = `${pad2(it.object_index)}. ${safeSegment(String(it.title ?? ""))}`;
      continue;
    }
    if (it._class !== "lecture") continue;
    const assets = Array.isArray(it.supplementary_assets) ? it.supplementary_assets : [];
    if (assets.length === 0) continue;
    const lectureDir = `${pad2(it.object_index)}. ${safeSegment(String(it.title ?? ""))}`;

    for (const a of assets) {
      if (!a || typeof a !== "object") continue;
      if (seenAsset.has(a.id)) continue;
      seenAsset.add(a.id);

      if (a.asset_type === "ExternalLink") {
        if (typeof a.external_url === "string" && a.external_url) {
          links.push({ chapter: chapterDir, lecture: lectureDir, title: String(a.title ?? ""), url: a.external_url });
        } else {
          skipped.push({ assetId: a.id, lectureId: it.id, reason: "no external url" });
        }
        continue;
      }
      if (a.asset_type !== "File") {
        skipped.push({ assetId: a.id, lectureId: it.id, reason: `unsupported type ${a.asset_type}` });
        continue;
      }
      const url = fileUrl(a);
      if (!url) {
        skipped.push({ assetId: a.id, lectureId: it.id, reason: "no download url" });
        continue;
      }
      const filename = safeSegment(String(a.filename || a.title || `asset-${a.id}`), 120);
      const size = Number.isFinite(a.file_size) ? a.file_size : null;
      if (size === null) unknownSizeCount++;
      else totalBytes += size;
      items.push({ lectureId: it.id, assetId: a.id, filename, size, url, path: `${root}/${chapterDir}/${lectureDir}/${filename}` });
    }
  }

  const paths = uniquePaths(items.map((i) => i.path));
  items.forEach((i, idx) => (i.path = paths[idx]));

  return { courseSlug: course.slug, courseTitle: course.title ?? course.slug, root, items, links, skipped, totalBytes, unknownSizeCount };
}

// ---------- 以下需要瀏覽器 ----------

const MAX_PAGES = 20;

/** 跟著 next 抓完所有 curriculum items。 */
export async function fetchCurriculum(courseId) {
  let url = curriculumUrl(courseId);
  const all = [];
  for (let page = 0; page < MAX_PAGES && url; page++) {
    const res = await fetch(url, { credentials: "same-origin" });
    if (!res.ok) throw new Error(`curriculum API ${res.status}`);
    const json = await res.json();
    all.push(...(json.results ?? []));
    url = json.next ? new URL(json.next, location.origin).pathname + new URL(json.next, location.origin).search : null;
  }
  return all;
}

/** learn 頁 URL → course slug。 */
export function parseCourseSlug(url) {
  const m = /\/course\/([^/]+)\//.exec(url ?? "");
  return m ? m[1] : null;
}
