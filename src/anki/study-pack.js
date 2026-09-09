export function formatTimestamp(seconds) {
  if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) throw new TypeError("時間必須是非負有限數字");
  const ms = Math.round(seconds * 1000);
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  const x = ms % 1000;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(x).padStart(3, "0")}`;
}

export function findUnitContext(results, unitId) {
  if (!Array.isArray(results)) throw new TypeError("課程目錄必須是陣列");
  let chapter = "未分類";
  for (const item of results) {
    if (item?._class === "chapter") chapter = String(item.title || "未命名章節").trim();
    if (item?._class === "lecture" && String(item.id) === String(unitId)) {
      return { id: String(item.id), chapterTitle: chapter, title: String(item.title || "未命名單元").trim(), objectIndex: Number.isFinite(item.object_index) ? item.object_index : null };
    }
  }
  return null;
}

function renderCues(items, label) {
  if (!Array.isArray(items)) throw new TypeError(`${label} cue 必須是陣列`);
  return [...items].sort((a, b) => a.start - b.start).map((cue, index) => {
    if (!cue || typeof cue.text !== "string" || !cue.text.trim()) throw new TypeError(`${label} cue[${index}] 字幕文字不得為空`);
    if (!Number.isFinite(cue.start) || !Number.isFinite(cue.end) || cue.start < 0 || cue.end < cue.start) throw new TypeError(`${label} cue[${index}] 時間無效`);
    return `[${formatTimestamp(cue.start)} --> ${formatTimestamp(cue.end)}] ${cue.text}`;
  }).join("\n");
}

export function renderStudyPack({ course, unit, enCues = [], zhCues = [], generatedAt = new Date().toISOString() }) {
  if (!course?.id || !course?.title || !course?.slug) throw new TypeError("course metadata 不完整");
  if (!unit?.id || !unit?.chapterTitle || !unit?.title || !unit?.url) throw new TypeError("unit metadata 不完整");
  if (enCues.length === 0 && zhCues.length === 0) throw new Error("沒有可匯出的字幕");
  const schema = { schemaVersion: 1, course, unit, cards: [], warnings: [] };
  return `# Udemy Boost GPT 學習包

- 課程：${course.title}
- 課程 ID：${course.id}
- 章節：${unit.chapterTitle}
- 單元：${unit.title}
- 單元 ID：${unit.id}
- URL：${unit.url}
- 產生時間：${generatedAt}

## GPT 指令

僅依據下方字幕產生 5–10 張高價值 Basic 或 Cloze 卡片。每張卡只測一個知識點，優先處理因果、比較、步驟、判斷條件與常見錯誤。字幕無法支持的內容放入 warnings，不得編造成卡片。只輸出合法 JSON，頂層格式：

\`\`\`json
${JSON.stringify(schema, null, 2)}
\`\`\`

Basic 欄位：type、front、back、sourceStartSec、sourceEndSec、reason、tags。Cloze 欄位：type、text、extra、sourceStartSec、sourceEndSec、reason、tags，text 至少包含一個 {{c1::答案}}。

## 英文字幕

${renderCues(enCues, "英文") || "（無）"}

## 中文字幕

${renderCues(zhCues, "中文") || "（無）"}
`;
}
