# Spec: Phase 5 — 專注度量測 / 介入 + 檔案直寫（CSV 為主、MD 延續舊記錄）

狀態：已確認並實作（v0.5.0，2026-09-09）。A 3 秒、B 關/30 分、C 保留備份、D 一行一段。實作後修訂以【實作後修訂】標示。
日期：2026-09-09
前置：Phase 1–4（v0.4.2）

## 目標

1. **記錄可延續**：資料落在你的磁碟（CSV），不再只靠 `chrome.storage`——extension 重裝 / ID 改變 / 換電腦都不會歸零；已有的 `progress.md` 會被讀回當起點。
2. **專注度量測**：每講記錄分心次數、專注比、回看、暫停、最長連續專注段、時段；寫進 `progress.md` 每章分析段 + 課程層週期分析。
3. **介入**（全部可獨立開關）：失焦自動暫停、Pomodoro 休息提醒、講次結束回想筆記、今日觀看分鐘數、切回時顯示離開多久。

## 非目標

- 不做 webcam / 眼動偵測；不封鎖其他網站。
- 不做跨課程總覽（沿用 Phase 4 決定）。
- 不做圖表；分析以表格文字呈現。
- 舊 `progress.md` 只讀我們自己產的格式；手改過格式解析失敗就跳過並在 md 註明。

## 關鍵技術決策：用 File System Access API 直寫，不再走 downloads

Phase 3/4 用 `chrome.downloads` 寫檔：只能寫、不能讀、每次跳下載提示、也讀不到舊檔。要「延續舊記錄」與「CSV 追加」必須能讀寫同一個檔。

- 在設定頁按「選擇 Udemy 資料夾」→ `window.showDirectoryPicker()`（一次），`FileSystemDirectoryHandle` 存進 extension origin 的 IndexedDB。
- 之後由 **offscreen document**（`chrome.offscreen`，extension origin 的隱藏頁）負責所有讀寫：content script 把資料送 background → background 開 offscreen → offscreen 拿 handle 讀寫檔案。
  理由：content script 的 IndexedDB 是 udemy.com origin 拿不到 handle；service worker 沒有 `createWritable()`。
- 權限：Chrome 122+ 對 File System Access 有「持續授權」，重開瀏覽器 `queryPermission()` 仍為 `granted`。**這點需在你的 Chrome 152 實測**；若每次重開都變 `prompt`，退路是 popup 顯示「重新授權資料夾」一鍵（需 user gesture），未授權期間先暫存 `chrome.storage`，授權後補寫。
- 沒選資料夾 → 一切行為同 Phase 4（downloads 匿名寫、不讀舊檔）。設定頁清楚標示目前模式。
- 補充資源下載（Phase 3）維持 downloads API（大檔、進度、續傳都是它強項），路徑不變，所以 CSV / MD 與資源在同一個 `Udemy/<課程>/`。

## 檔案

```
Udemy/<課程名稱>/
  progress.md      # 由 CSV + Udemy 完成清單 重新產生（含分析）；舊檔會先被讀回
  watch-log.csv    # 追加式，一行一個「觀看段」（source of truth）
  notes.md         # 講次結束回想筆記（介入 3），追加式
  <章>/<講>/...    # Phase 3 資源
```

### `watch-log.csv`（UTF-8 with BOM，Excel 直開不亂碼；逗號分隔、RFC 4180 引號）

一行 = 一個 **segment**：從開始計時到停止計時（暫停 / 失焦 / 閒置 / 換講 / 關頁）的一段連續觀看。

| 欄位 | 型別 | 說明 |
|---|---|---|
| segment_start | ISO 8601 本地含時區 | `2026-09-09T21:03:15+08:00` |
| segment_end | ISO 8601 | |
| lecture_id | int | |
| chapter_index / lecture_index | int | 產生 md 時仍以 curriculum 為準，這裡只是方便直接看 CSV |
| lecture_title | string | |
| watched_ms | int | 該段計入的時間 |
| video_pos_start_s / video_pos_end_s | float | 影片位置，用來算專注比與回看 |
| playback_rate | float | 該段平均播放速率 |
| end_reason | enum | `pause` / `blur` / `hidden` / `idle` / `lecture_switch` / `page_hide` / `ended`；【實作後修訂】`seek` 不再是結束原因——拖進度條不切段，只記回看到 `seek_back_*`，避免一講被切成幾十段 |
| seek_back_count / seek_back_s | int / float | 該段內往回跳的次數與總秒數（<2s 忽略） |
| ext_version | string | 寫入時的 extension 版本，之後改欄位好判斷 |

- 完成事件另寫一行：`end_reason = completed`，`watched_ms = 0`，`segment_start = segment_end = completedAt`。
- 【實作後修訂】`imported` 行的 `video_pos_*` / `playback_rate` / `video_duration_s` 為空；分析時「點」（imported / completed）不參與影片長度與位移計算。
- 追加時機：segment 結束當下；寫失敗（無權限 / 檔案鎖住）→ 暫存 `chrome.storage.local` queue，下次成功時補寫，順序保留。
- 不做去重：同一講兩分頁同時看會有重疊段，分析時以 `segment_start` 排序合併重疊區間再算時間（合併邏輯純函式、可測）。

### 分析（由 CSV 計算，純函式 `analysis.js`）

每講：
- `watched`：合併重疊後的總時間
- `distractions`：`end_reason ∈ {blur, hidden, idle}` 的段數
- `focus_ratio`：Σ(`video_pos_end − video_pos_start`，只算正向) ÷ 影片長度；>1 截 1（影片長度來自 `video.duration`，寫在第一段的額外欄位 `video_duration_s`）
- `seek_back`：次數 / 秒數
- `pauses` / `longest_pause`：相鄰段之間、同一講、間隔 < 30 分鐘者算暫停；≥ 30 分鐘視為不同 session
- `longest_focus`：單段最長 `watched_ms`
- `sessions`：依 30 分鐘間隔切

每章：上述加總 / 平均（distractions 總數、focus_ratio 以講次影片長度加權平均、longest_focus 取 max）。

課程層「定期分析」（每次產 md 都重算，不需排程）：
- 最近 7 天 / 30 天：觀看時數、完成講數、平均 focus_ratio、分心次數／小時
- 時段分布：以 `segment_start` 的小時分 6 個時段（00–04 / 04–08 / … ），列每時段總時數與平均 focus_ratio，標出最佳時段
- 週趨勢：最近 8 週每週時數與 focus_ratio 一列

### `progress.md` 新版格式（在 Phase 4 格式上加欄與段）

```markdown
# <課程>

- 更新：… · 進度：… · 累計觀看：…（來源：watch-log.csv，含匯入的舊記錄）
- 最近 7 天：3h 40m · 完成 6 講 · 專注比 0.84 · 分心 2.1 次/小時
- 最佳時段：20–24 時（專注比 0.91，共 5h 10m）

## 01. Introduction ✅ 9/9 · 1h 05m · 完成於 …
分析：專注比 0.88 · 分心 4 次 · 回看 7 次 (3m 20s) · 最長連續 22m 15s · 3 個 session

| # | 講次 | 狀態 | 觀看 | 專注比 | 分心 | 回看 | 完成時間 |
| 1 | Course Guide | ✅ | 4m 12s | 0.95 | 0 | 0 | 2026-09-03 20:10 |

## 週趨勢
| 週 | 時數 | 完成講 | 專注比 | 分心/h |
| 2026-W36 | 4h 02m | 7 | 0.83 | 2.4 |

## 時段分布
| 時段 | 時數 | 專注比 |
```

- `notes.md` 內容不混進 progress.md；progress.md 講次列若有筆記，加 📝 標記。

### 匯入舊 `progress.md`（一次性）

- 【實作後修訂】觸發條件改為「`progress.md` 存在且是舊格式」（不看 CSV 是否存在）：先播影片再連結資料夾時，佇列補寫會先把 CSV 建出來，若以 CSV 存在與否判斷會漏掉匯入並覆蓋舊 md（e2e 抓到）。匯入行以「追加」寫入 CSV。原文：若 `watch-log.csv` 不存在且 `progress.md` 存在 → 解析 Phase 4 格式的講次表格（`| # | 講次 | 狀態 | 觀看 | 完成時間 |`），每講產一行 CSV：`end_reason = imported`，`watched_ms` 由「4m 12s」解析，`segment_start/end` 用「完成時間」欄或檔案更新時間，`completed` 另一行。
- 也把 `chrome.storage` 內 Phase 4 的 `lp:<courseId>` 匯進去（同樣標 `imported`），之後 storage 只做暫存 queue。
- 匯入結果在 md 頂部註明「匯入舊記錄 N 講，其中 M 講時間不可考」。解析失敗的列列在「匯入略過」段。
- 匯入前先把舊 `progress.md` 複製成 `progress.<日期>.bak.md`。

## 介入（皆為選項，預設值如下）

| # | 選項 | 預設 | 行為 |
|---|---|---|---|
| 1 | `fxAutoPause` | 開 | 播放中視窗失焦或分頁隱藏 → `video.pause()`；回來不自動播（你自己按）。有 `fxAutoPauseDelayS`（預設 3 秒）避免 alt-tab 一下就暫停 |
| 2 | `fxPomodoro` / `fxPomodoroMin` | 關 / 30 | 連續計時累積到 N 分鐘 → overlay 顯示「已連續 30 分鐘，休息一下」，可點關閉；不強制暫停。休息（停計 ≥ 5 分鐘）後歸零 |
| 3 | `fxRecallPrompt` | 開 | 影片 `ended` → overlay 出現輸入框「這講的重點（一句話）」+「略過」。送出 → 追加到 `notes.md`：`## <NN. 章> / <NN. 講>` `- 2026-09-09 21:30 — <內容>`。略過不寫。不阻擋 Udemy 自動跳下一講（Udemy 自動播放時輸入框留在畫面上直到送出或略過） |
| 4 | `fxTodayMinutes` | 開 | overlay 狀態列尾端顯示「今日 47m」（從 CSV / 暫存算今天 00:00 起的觀看）。不設目標、不顯示進度條 |
| 5 | `fxAwayNotice` | 開 | 失焦 / 隱藏 / 閒置後回到頁面 → 狀態列顯示「離開 4m 12s」6 秒後淡出；< 30 秒不顯示 |

全部集中在設定頁「專注」區。

- 【0.5.3 修正】離開判定必須只看「分頁可見 / 視窗焦點 / 閒置」，**不得**從觀看段的 `end_reason` 反推：
  `fxAutoPause` 會在離開 3 秒後把影片暫停，`end_reason` 隨即變成 `pause`，會被誤判成已回來。
  純函式 `src/focus/away.js` 的 `isAway()` 簽章刻意不含 playing / paused / reason。
  離開起點另由 `blur` / `visibilitychange` 事件當下定住（分頁隱藏時 `setInterval` 被節流到約每分鐘一次）。
- 【0.5.1 修正】0.5.0 這七個選項沒接上 `FIELDS`，既不還原也不儲存；同時 `saveOptions` 的讀整包/寫整包會讓同時變更互相覆蓋。
  設定頁接線與 `saveOptions` 併發語意現在有測試（`tests/options-wiring.test.js`、`tests/options-store.test.js`、`tests/e2e/options-persist.mjs`）。

## 契約（純函式，全部可測）

- `csv.js`：`toRow(segment)` / `parseRows(text)`（RFC 4180，含引號、換行、BOM）、`mergeOverlaps(segments)`。
- `analysis.js`：`perLecture(segments, durationS)`、`perChapter(lectures)`、`recentWindow(segments, days, now)`、`byHourBucket(segments)`、`weekly(segments, weeks, now)`、`sessions(segments, gapMin=30)`。
- `importer.js`：`parseProgressMd(text)` → `{ rows, skipped }`；`fromPhase4Log(log)`。
- `render.js`：Phase 4 的 `renderMarkdown` 擴充；`renderNoteEntry(...)`。
- `focus/segmenter.js`：把 tracker 的每秒 tick + video 事件切成 segment（狀態機：`idle → counting → ended(reason)`），回看偵測（`seeked` 且新位置 < 舊位置 − 2s）。
- `fs/`（瀏覽器）：`pickDirectory()`、`getHandle()`、`ensurePermission()`、`readText(path)`、`appendText(path, text)`、`writeText(path, text)`、`exists(path)`；子目錄自動建立。

## 邊界條件

- 課程名稱含 Windows 非法字元 → 沿用 `safeSegment`，與 Phase 3 目錄一致。
- 使用者手動編輯 CSV（Excel 存檔可能改編碼 / 換行）→ 讀回用寬鬆解析：BOM 可有可無、CRLF/LF、欄位順序以 header 為準、缺欄補空；壞行跳過並計數寫進 md。
- CSV 很大（一年 ~ 每天 50 段 = 18k 行、~3 MB）→ 讀寫都是整檔，OK；> 20 MB 時只讀最後 20 MB 並在 md 註明。
- 資料夾被移走 / 改名 → handle 失效 → 設定頁顯示「找不到資料夾，請重新選擇」，期間資料進暫存 queue。
- 兩個 Udemy 分頁同時寫 CSV → offscreen document 單例序列化寫入（promise chain），不會交錯。
- 回想輸入框與 Udemy 自動下一講：輸入框固定在 overlay，講次切換不清掉，直到送出或略過；送出時記的是「上一講」的 id。
- 自動暫停與 Udemy 自己的行為衝突（Udemy 在分頁隱藏時也可能暫停）→ 我們只在 `!video.paused` 時呼叫 pause，冪等。

## 權限

- `permissions` += `offscreen`
- 【0.5.2】`permissions` += `scripting`：extension 重新載入後既有分頁沒有 content script，
  設定頁需要 `executeScript` 補注入，否則 `tabs.sendMessage` 會回
  「Could not establish connection. Receiving end does not exist.」。
  「哪些分頁算播放頁」統一由 `src/learn-url.js` 讀 manifest 的 `content_scripts.matches` 判斷。
- File System Access 不需 manifest 權限，靠使用者選資料夾。

## 驗收

1. 設定頁選 `Downloads/Udemy` → 顯示「已連結」；重開 Chrome 後仍為已連結（若否，記錄實測結果並走退路）。
2. 已有 `progress.md` 的課程第一次匯出 → 產生 `.bak.md`、`watch-log.csv` 內含 `imported` 行、新 md 頂部有匯入摘要，Phase 4 的觀看時間沒有歸零。
3. 看 2 分鐘、中途 alt-tab 一次 10 秒（影片自動暫停）、往回拉一次 → CSV 多 2–3 行，`end_reason` 正確，md 該講分心 1、回看 1。
4. 講次結束 → 回想框 → 輸入 → `notes.md` 多一段；略過 → 不寫。
5. Pomodoro 設 1 分鐘（測試用）→ 提示出現；休息 5 分鐘後歸零。
6. 狀態列顯示「今日 Nm」且與 CSV 加總一致；離開 40 秒回來顯示「離開 40s」。
7. 單元測試：csv（引號 / 換行 / BOM / 壞行）、mergeOverlaps（無重疊 / 部分 / 完全包含 / 空）、analysis 各函式（空 / 單段 / 跨日 / 跨週 / 30 分鐘邊界）、importer（正常 / 手改壞列 / 空表）、segmenter 狀態機（每種 end_reason）、回看偵測（<2s 忽略）。
8. e2e：假資料夾用 OPFS 或 Playwright 的 `showDirectoryPicker` mock，走完 匯入 → 觀看 → 匯出 → 讀回 CSV 行數。

## 實作前驗證結果

- [ ] Chrome 152：extension 頁 `showDirectoryPicker()` 可用；重開後 `queryPermission()` 是否仍 `granted` — **需 Jimmy 實機**；未授權時設定頁有「重新授權」，期間寫入進佇列。
- [x] offscreen document 內用 IndexedDB 存回的 handle `createWritable({keepExistingData})` + `seek` 追加可寫（headless Chromium 141 以 OPFS 驗證；user-picked handle 的權限層另計）。
- [ ] Udemy `ended` → 自動下一講時序未實測；實作以 `pendingRecall` 讓輸入框跨 Session 存活，新講次的 overlay 建好就接手。

## 其他實作備註

- popup 內開 `showDirectoryPicker` 會把 popup 關掉，所以「選擇資料夾」在 popup 內按會另開設定頁分頁（`?mode=tab`），在分頁裡再按一次。
- 自動暫停只在 `hidden` / `blur` 觸發，`idle` 不暫停（人可能只是沒動滑鼠在看）。
- 佇列存 `chrome.storage.local`（`ub:fsq`），連結 / 授權成功時由設定頁觸發補寫。
- notes.md 每則前有 `<!-- lecture:ID -->` 註記，progress.md 的 📝 標記靠它對回講次。
- `lp:export` 在資料夾已連結時走新流程並回 `mode:'folder'`，否則維持 Phase 4 downloads（`mode:'downloads'`）。

## 需要你決定

- A. `fxAutoPause` 延遲 3 秒 OK？（0 = 立即）
- B. Pomodoro 預設關、預設分鐘數：Jimmy 決定 30（原提 50）。
- C. 舊 `progress.md` 匯入後，原檔備份成 `progress.<日期>.bak.md` 保留，還是直接覆蓋？預設保留。
- D. CSV 一行一段（細、可重算任何指標）vs 一行一 session（粗、人眼好讀）？預設一段；md 有 session 數，人眼看 md 就好。
