// 檔名 / 資料夾名清洗。純函式。

// eslint-disable-next-line no-control-regex
const ILLEGAL = /[<>:"/\\|?*\x00-\x1f\x7f]/g;
const RESERVED = /^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i;

function splitExt(name) {
  const i = name.lastIndexOf(".");
  if (i <= 0) return [name, ""];
  return [name.slice(0, i), name.slice(i)];
}

/** 清成 Windows / macOS / Linux 都合法的單一路徑段。 */
export function safeSegment(s, max = 80) {
  if (typeof s !== "string") throw new TypeError("safeSegment expects a string");
  let out = s.replace(ILLEGAL, "").replace(/^[\s.]+|[\s.]+$/g, "");
  if (out === "") return "_";
  let [base, ext] = splitExt(out);
  if (RESERVED.test(base)) base += "_";
  const budget = max - [...ext].length;
  const cps = [...base];
  if (cps.length > budget) base = cps.slice(0, Math.max(1, budget)).join("");
  return (base + ext).replace(/^[\s.]+|[\s.]+$/g, "") || "_";
}

export function pad2(n) {
  const v = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  return String(v).padStart(2, "0");
}

/** 同路徑（不分大小寫）重複 → 第 2 個起加 " (2)"、" (3)"…，放在副檔名前。 */
export function uniquePaths(paths) {
  const seen = new Map(); // lower path → count
  return paths.map((p) => {
    const key = p.toLowerCase();
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    if (n === 1) return p;
    const slash = p.lastIndexOf("/");
    const dir = slash === -1 ? "" : p.slice(0, slash + 1);
    const [base, ext] = splitExt(p.slice(slash + 1));
    return `${dir}${base} (${n})${ext}`;
  });
}
