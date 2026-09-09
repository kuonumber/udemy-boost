# Spec: Phase 4 — 學習歷程（每門課一份 progress.md）

狀態：已確認並實作（v0.4.0）。Jimmy 決定：A 加「3 分鐘無滑鼠鍵盤就停計」（可設 0–120 分，0 = 不停）；B 自動更新 md 預設關；C 不做跨課程索引。
日期：2026-09-04
前置：Phase 1–3 已完成（v0.3.2）

## 目標

每門課維護一份 Markdown 學習歷程：哪些章節 / 講次已完成、每章與每講花了多少時間、何時完成。
存到與補充資源相同的目錄：`Downloads/Udemy/<課程名稱>/progress.md`，可手動匯出，也可選每次完成講次自動更新。

## 非目標

- 不做跨課程總覽（每課一份 md；總覽若要，另開 phase）。
- 不做圖表、不做 Notion / Google Sheet 同步。
- 不追蹤影片以外的項目花費時間（quiz / 文章 / 練習只記完成與否，時間為 —）。
- 不回推安裝前的花費時間（Udemy 不提供）。

## 實測（2026-09-04）

- `GET /api-2.0/users/me/subscribed-courses/{courseId}/progress/?fields[course]=completion_ratio,completed_lecture_ids,completed_quiz_ids,num_completed_lectures`
  → 200：`completed_lecture_ids: [5 個 id]`、`completion_ratio: 8`、`num_completed_lectures: 5`。
  **只有「哪些完成了」，沒有完成時間、沒有花費時間**，這兩項必須由 extension 本地記錄。
- `/completion-ratio/` 404、`/lectures/?fields[lecture]=is_completed` 500，不可用。
- curriculum API（Phase 3 已用）提供章節 / 講次結構與順序。

## 資料模型（`chrome.storage.local`，key = `lp:<courseId>`）

```
{
  courseId, courseTitle, slug,
  lectures: {
    [lectureId]: {
      watchedMs: number,          // 累計觀看牆鐘時間（見「時間計量」）
      firstSeenAt: ISO string,     // 第一次在本 extension 開這講
      lastSeenAt: ISO string,
      completedAt: ISO string | null,   // 本 extension 觀察到「變成完成」的時間
      completedBefore: boolean          // 安裝前就已完成（Udemy 說完成但我們沒看到轉變）→ 時間未知
    }
  },
  updatedAt: ISO string
}
```

- 完成判定來源：Udemy progress API 的 `completed_lecture_ids`（權威）。extension 在「每次講次切換」與「影片 `ended`」時重抓一次；
  若某 lectureId 從不在 → 在，記 `completedAt = now`。第一次為某課建檔時已在清單裡的 → `completedBefore = true`。
- 不自己判定完成（例如看滿 90%），完全跟 Udemy 的勾勾一致，避免 md 與 Udemy 頁面不一致。

## 時間計量

- 計「牆鐘時間」：`video` 在播放（`!paused && !ended`）**且**分頁可見（`document.visibilityState === 'visible'`）的期間，每秒累加 1000ms。
  1.5x 播放 10 分鐘影片 = 6m40s，記 6m40s（你實際花的時間）。
- 暫停、切分頁、切講次、關頁 → 停止累加；每 10 秒與 `visibilitychange` / `pagehide` / 講次切換時 flush 到 storage（最多丟 10 秒）。
- 【0.4.1】不在頁面上就停計（`lpRequireFocus`，預設開）：`document.hasFocus()` 為 false（視窗失焦 / 切到別的 app）就停止累加；並排視窗焦點在別處時也會停，需要邊看邊做筆記可關閉。
- 【實作後修訂】閒置停計：連續 `lpIdleMinutes`（預設 3）分鐘沒有 pointermove / pointerdown / keydown / wheel / touchstart 就停止累加；設 0 關閉。判斷在 `shouldCount()` 純函式。

## Markdown 格式

```markdown
# Complete Blender 2026: From Beginner to Studio-Ready with AI

- 更新：2026-09-04 21:30
- 進度：12 / 62 講（19%）· 8 章中 1 章完成
- 累計觀看：3h 12m（本 extension 安裝後起算）

## 01. Introduction to Blender ✅ 9/9 · 1h 05m · 完成於 2026-09-03 22:41

| # | 講次 | 狀態 | 觀看 | 完成時間 |
|---|------|------|------|----------|
| 1 | Course Guide | ✅ | 4m 12s | 2026-09-03 20:10 |
| 2 | Download and install blender | ✅ | — | （安裝前） |
| 3 | Interface and settings | ✅ | 18m 03s | 2026-09-03 21:02 |

## 02. Modeling in Blender ⏳ 3/12 · 2h 07m

| # | 講次 | 狀態 | 觀看 | 完成時間 |
| 10 | Low poly chair | ✅ | 41m 20s | 2026-09-04 09:15 |
| 11 | Stylized House modeling part 1 | ▶ 進行中 | 12m 05s | |
| 12 | Stylized House modeling part 2 | ☐ | | |
```

- 章節「完成於」= 該章最後一個完成講次的 `completedAt`；若任一講次 `completedBefore` 且無時間 → 顯示「（部分安裝前）」。
- 章節時間 = 該章講次 `watchedMs` 總和；課程累計 = 全部總和。
- 狀態：✅ 完成 / ▶ 進行中（有 watchedMs 但未完成）/ ☐ 未開始。quiz / practice：狀態 ✅ 或 ☐，時間 —。
- 時區：使用者本地時區（`Intl.DateTimeFormat` 預設），格式 `YYYY-MM-DD HH:mm`。

## 匯出

- popup 「學習歷程」區：顯示本課摘要（進度 / 累計時間）、「匯出 progress.md」按鈕、「每次完成講次自動更新」勾選（預設關）、「清除本課記錄」。
- 匯出走 background `chrome.downloads.download`（`data:` URL，`conflictAction: 'overwrite'`，path `Udemy/<課程名稱>/progress.md`），沿用 Phase 3 的 `onDeterminingFilename` 強制命名。
- 自動更新：偵測到新完成講次 → 重新產生並 overwrite。Chrome 每次會閃一下下載提示，這是 downloads API 的限制，所以預設關。

## 契約（純函式，可測）

### `learning/log.js`
- `tick(rec, nowMs, deltaMs)`：累加 watchedMs、更新 lastSeenAt；`deltaMs <= 0` 或非數字 → 不變；回新物件。
- `applyCompletion(log, completedIds, nowIso, isFirstSync)`：把 Udemy 完成清單套進 log；新出現的記 `completedAt`；`isFirstSync` 時已完成的標 `completedBefore`。Udemy 端「取消完成」（id 消失）→ 清掉 `completedAt`（跟 Udemy 一致）。
- `buildReport(curriculum, log, now)` → 結構化報表 `{ title, updatedAt, totals:{lectures, completed, chapters, chaptersDone, watchedMs}, chapters:[{ index, title, done, total, watchedMs, completedAt|null, partialBefore, items:[{index,title,kind,status,watchedMs,completedAt}] }] }`。
- `renderMarkdown(report)` → 上述格式字串。
- `fmtDuration(ms)`：`< 1m` → `Ns`；`< 1h` → `Mm Ss`；否則 `Hh Mm`。0 / NaN → `—`。

### Messages
```
content → background: {type:'lp:export', courseId}      → 產 md 並下載
popup → content:      {type:'lp:summary'}               → {ok, summary:{completed,total,watchedMs,title}}
popup → content:      {type:'lp:export'} / {type:'lp:clear'}
```

## 邊界條件

- 同一講次開兩個分頁 → 兩邊都累加，會重複計時。用 `chrome.storage` 的 read-modify-write + 每 10 秒 flush，重複計時接受（罕見）；不做跨分頁鎖。
- 講次沒有影片（文章 / quiz）→ 不計時，只記完成狀態。
- progress API 失敗（離線 / 401）→ 保留上次完成清單，md 標「完成狀態更新於 <上次成功時間>」。
- 課程名稱變更 → 以最新 curriculum 為準重新 render，storage key 用 courseId 不受影響。
- 講次被講師刪除 → curriculum 沒有但 log 有 → 放到報表尾「已移除的講次」段，時間仍計入總計。
- storage 大小：每講 ~150 bytes，200 講 = 30 KB，遠低於 `chrome.storage.local` 10 MB 上限，不做淘汰。

## 權限

不需新增（`storage`、`downloads` 已有）。

## 驗收

1. 開 blender-start 任一講次播 1 分鐘 → popup 顯示累計約 1m；暫停 / 切分頁不累加。
2. 在 Udemy 勾完成一講 → 30 秒內 popup 進度 +1，`completedAt` 為當下時間。
3. 匯出 → `Downloads/Udemy/<課程名稱>/progress.md` 內容符合格式，已完成的 5 講標「（安裝前）」。
4. 開自動更新 → 再完成一講 → md 自動 overwrite。
5. `node --test` 新增：`tick`（0 / 負 / NaN / 正常）、`applyCompletion`（首次同步 / 新增 / 取消 / 空清單）、`buildReport`（無 log、部分完成、全完成、quiz、已移除講次、章節完成時間取 max）、`renderMarkdown`（快照）、`fmtDuration`（邊界）。
6. e2e：假 progress API + 真 video 播 3 秒 → storage 有 watchedMs ≥ 2500；匯出 md 內容含該講。

## 實作備註

- 完成同步時機：講次切換、影片 `ended`（1.5s / 5s / 15s 三次補抓）、以及每 30 秒輪詢。
- 記錄只在 `enabled`（extension 總開關）且 `lpEnabled` 都開時進行。
- 開發時踩到：background 對未知訊息 `return undefined` 不回應 → content 端 `await sendMessage` 永遠卡住；改為一律回 `{ok:false}`。

## 需要你決定（已決定，見狀態列）

- A. 時間計量要不要加「閒置停計」（N 分鐘無操作就不算）？預設不加。
- B. 自動更新 md 預設關（Chrome 每次會跳下載提示）— 可接受？
- C. md 只放 `Udemy/<課程名稱>/progress.md`，還是同時在 `Udemy/` 根目錄放一份跨課程 `README.md` 索引？預設只放前者。
