// ExternalLink → links.md。純函式。

function encodeUrl(u) {
  return u.replace(/[ )(]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function escapeTitle(t) {
  return t.replace(/[\[\]]/g, (c) => `\\${c}`);
}

/**
 * @param {string} courseTitle
 * @param {{chapter:string,lecture:string,title:string,url:string}[]} links
 */
export function render(courseTitle, links) {
  if (!Array.isArray(links)) throw new TypeError("links must be an array");
  const out = [`# ${courseTitle}`, ""];
  if (links.length === 0) {
    out.push("（本課程沒有外部連結）", "");
    return out.join("\n");
  }
  let lastChapter = null;
  for (const l of links) {
    if (l.chapter !== lastChapter) {
      out.push(`## ${l.chapter}`, "");
      lastChapter = l.chapter;
    }
    const text = l.title?.trim() ? escapeTitle(l.title.trim()) : l.url;
    out.push(`- [${text}](${encodeUrl(l.url)}) — ${l.lecture}`);
    // 章節結束時補空行：看下一筆是否換章
  }
  // 重新整理成章節間有空行的格式
  const lines = [];
  for (let i = 0; i < out.length; i++) {
    lines.push(out[i]);
    const next = out[i + 1];
    if (out[i].startsWith("- ") && next && next.startsWith("## ")) lines.push("");
  }
  lines.push("");
  return lines.join("\n");
}
