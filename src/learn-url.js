// 「哪些分頁算課程播放頁」的單一來源：直接用 manifest 的 content_scripts.matches，
// 不要在別處另寫一份正則（會與 manifest 漂移）。純函式部分可在 node 測試。

const ESCAPE = /[.+?^${}()|[\]\\]/g; // 故意不含 *，後面才把 * 換成 .*
const esc = (s) => s.replace(ESCAPE, "\\$&");

/** Chrome match pattern → RegExp（支援 <all_urls>、scheme `*`、host `*` 與 `*.domain`、path 的 `*`）。 */
export function matchPatternToRegExp(pattern) {
  if (pattern === "<all_urls>") return /^[a-z]+:\/\/.*/i;
  const m = /^(\*|[a-z]+):\/\/(\*|\*\.[^/*]+|[^/*]+)(\/.*)$/.exec(pattern);
  if (!m) throw new RangeError(`bad match pattern: ${pattern}`);
  const [, scheme, host, path] = m;
  const schemeRe = scheme === "*" ? "https?" : esc(scheme);
  const hostRe = host === "*" ? "[^/]+" : host.startsWith("*.") ? `(?:[^/]+\\.)?${esc(host.slice(2))}` : esc(host);
  const pathRe = esc(path).replace(/\*/g, ".*");
  return new RegExp(`^${schemeRe}://${hostRe}${pathRe}$`);
}

export function isLearnUrl(url, patterns) {
  if (typeof url !== "string" || !url) return false;
  return patterns.some((p) => matchPatternToRegExp(p).test(url));
}

// ---------- 需要瀏覽器 ----------

/** manifest 宣告的 content script match patterns。 */
export function learnPatterns() {
  return chrome.runtime.getManifest().content_scripts?.[0]?.matches ?? [];
}
