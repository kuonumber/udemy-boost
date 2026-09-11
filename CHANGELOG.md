# Changelog

## 0.1.0 - 2026-09-04

- 首版：Udemy 講次頁顯示英文 + 中文（Udemy 內建軌，zh_TW > zh_HK > zh_CN）對照字幕。
- 設定：啟用開關、字級、距底部、中文在上、隱藏原生字幕。

## 0.2.0 - 2026-09-04

- 簡體中文軌（zh_HK / zh_CN）自動轉台灣繁體（OpenCC s2twp），可在設定關閉。
- 無中文軌時可用機器翻譯：Chrome 內建 Translator API 或自架 LibreTranslate，首選失敗自動切換；結果快取。
- 字幕可在影片上直接拖動，位置跨講次保存；設定頁有「位置重設」。
- 狀態列顯示中文來源（內建軌 / 轉繁 / 機翻 provider / 快取）與翻譯進度。

## 0.3.0 - 2026-09-04

- 新增「課程補充資源」一鍵下載：掃描整門課 Resources（PDF / zip / .blend…）→ 顯示摘要 → 確認後存到 `Udemy/<課程>/<章>/<講>/`，外部連結整理成 `links.md`。不含影片。
- 修正：OpenCC 轉繁失敗不再把整個字幕標成「載入失敗」；錯誤訊息帶原因。
- 新增 e2e 測試（Playwright 載入未封裝 extension）。

## 0.3.1 - 2026-09-04

- 修正：下載的檔案沒有進子目錄（Chrome 在 Windows 上忽略 `download()` 的 filename、改用 CDN 檔名）。改在 `onDeterminingFilename` 強制指定路徑。
- 課程資料夾改用課程名稱（原為 URL slug）：`Udemy/<課程名稱>/<章>/<講>/`。

## 0.3.2 - 2026-09-04

- 改名 Udemy Boost（功能已不只字幕）。資料夾與內部 `ub-` 前綴沿用。

## 0.4.0 - 2026-09-04

- 新增「學習歷程」：記錄每講觀看時間（播放中 + 分頁可見 + 3 分鐘內有操作才計）、同步 Udemy 完成狀態並記下完成時間；popup 顯示本課摘要，可匯出 `Udemy/<課程>/progress.md`（章節完成度 / 累計時間 / 完成於 / 講次表格），可選每次完成講次自動更新。
- 修正：background 對未知訊息不回應導致呼叫端卡住。

## 0.4.1 - 2026-09-04

- 學習歷程新增「不在頁面上就停計」（預設開）：視窗失焦（alt-tab 到別的 app、切到別的視窗）即停止累加，即使 Chrome 仍露在螢幕上。原本只看分頁是否可見（`visibilityState`），切到別的 app 時 Chrome 分頁仍算「可見」。

## 0.4.2 - 2026-09-04

- 專案資料夾改名 `udemy-boost`，內部 CSS / log 前綴 `uds-` → `ub-`，Phase 1 規格檔改名 `phase1-dual-subtitles.md`。功能無變動。**需在 chrome://extensions 移除舊的、從新資料夾重新「載入未封裝項目」。**

## 0.5.0 - 2026-09-09

- **檔案直寫**：設定頁「選擇資料夾」連結 `Downloads/Udemy` 後，progress.md / watch-log.csv / notes.md 直接讀寫，不再跳下載提示；舊的 progress.md 會備份並匯入；未連結時維持原行為。
- **watch-log.csv**：每個觀看段一行（時間、講次、影片位置、速率、結束原因、回看），是學習資料的真相來源。
- **progress.md 新格式**：每章「分析」行（專注比 / 分心 / 回看 / 最長連續 / session）、講次表加專注比 / 分心 / 回看欄、最近 7/30 天、最佳時段、8 週趨勢、時段分布。
- **專注介入（皆可開關）**：失焦 3 秒自動暫停（預設開）、連續觀看 30 分提醒休息（預設關）、講次結束回想一句話寫入 notes.md（預設開）、狀態列顯示今日分鐘數（預設開）、回來時顯示離開多久（預設開）。

## 0.5.1 - 2026-09-09

- 修正：「專注」區七個設定完全沒接上——`FIELDS` 漏了它們，所以開啟 popup 不會還原（永遠顯示未勾）、勾了也不會儲存。
- 修正：`saveOptions` 原本「讀整包 → 合併 → 寫整包」，同時變更多個欄位時只有最後一個存得住；改為只寫被改動的 key。
- 設定頁少一個控制項不再中斷後面所有欄位的初始化（改為記 console error 後跳過）。
- 新增測試：設定頁接線靜態檢查（DEFAULT_OPTIONS ↔ options.html ↔ FIELDS 三處必須同步）、`saveOptions` 併發語意、以及真瀏覽器的設定往返 e2e（`tests/e2e/options-persist.mjs`）。

## 0.5.2 - 2026-09-09

- 修正「匯出失敗：Could not establish connection. Receiving end does not exist.」：extension 重新載入 / 更新後，既有的 Udemy 分頁不會被自動注入 content script。設定頁現在會先 ping，失敗就用 `chrome.scripting.executeScript` 補注入再重試；真的不行才給「請重新整理該 Udemy 分頁」這種看得懂的訊息。
- 修正設定頁以分頁模式（選資料夾用的 `?mode=tab`）開啟時，掃描 / 摘要 / 匯出 / 清除四個按鈕全部失效——原本只看「當前分頁」，而當前分頁正是設定頁自己；改為找得到其他 Udemy 播放頁分頁。
- 「哪些分頁算播放頁」改為直接讀 manifest 的 `content_scripts.matches`，不再另寫一份正則。
- content script 加重複注入防護，補注入不會產生兩份計時 / 兩份 CSV 行。
- 匯出成功訊息會標明是「直寫資料夾」或「下載模式」。
- 權限新增 `scripting`（僅用於上述補注入）。

## 0.5.3 - 2026-09-09

- 修正「離開多久」永遠不顯示：離開判定原本是從觀看段的結束原因推出來的，而「失焦自動暫停」（預設開）在離開 3 秒後把影片暫停，結束原因隨即變成「暫停」，被誤判成已回來，離開起點在第 4 秒就被清掉。現在離開只看分頁可見 / 視窗焦點 / 閒置，與影片是否播放無關。
- 離開起點改由 `blur` / `visibilitychange` 事件當下定住：分頁切到背景時 Chrome 會把 `setInterval` 節流到約每分鐘一次，靠每秒 tick 會少算離開時間。
- 自動暫停的觸發條件同步改為看可見 / 焦點（閒置仍然不暫停）。
- 提示顯示時間 5 → 6 秒。

## 0.6.0 - 2026-09-09

- **GPT → Anki 重新接線**：`src/anki/*` 與其 14 支測試一直在工作區，但接線的三個檔案（manifest、options.html、options.js）在 0.5.x 的重新發佈中被整檔覆寫，功能實際上是死的（`npm test` 有 3 個契約測試紅著）。popup 的「GPT → Anki」區塊補回：Extension Origin 顯示、配對 token、處理工具（Codex / Claude）、測試連線、匯出學習包、送到 AI Inbox、卡片 JSON 匯入、逐張審核（編輯 / 取消）、確認同步、清除草稿。
- 學習包匯出：`Udemy/<課程>/<章>/<單元>/study-pack.md`（資料夾已連結就直寫，否則走下載）。範圍固定為目前單元。
- Inbox 送出後輪詢 `GET /v1/inbox/items/<id>`（每 2 秒，最多約 5 分鐘）；`review_ready` 的卡片一律用同一套 validator 重新驗證，並要求 course / unit 與目前頁面完全相符才收下。
- 卡片草稿存 `chrome.storage.local`（key 以 course + unit 組成），重開 popup 會接續；同步成功的卡片不會重送；只有明確按「清除草稿」才刪除。
- 配對 token 只存 `chrome.storage.session`，background 明確設定 `TRUSTED_CONTEXTS`，content script 讀不到。
- **權限收窄（行為變更）**：`host_permissions` 移除 `http://localhost/*` 與 `http://127.0.0.1/*`，只留 `https://www.udemy.com/*` 與 `http://127.0.0.1:8765/*`（AnkiConnect）。自架 LibreTranslate 的位址（含 localhost）改由設定頁「授權此網址」按鈕動態授權。詳見 ADR 0008。
- 新增 e2e `tests/e2e/anki-popup.mjs`：不需要 anki-mcp-server，8766 / 8765 都在瀏覽器層假造，涵蓋匯出、JSON 匯入（含課程不符必須拒絕）、送出 → 輪詢 → 草稿、編輯 / 取消 / 同步、草稿續存與清除，共 17 checks。
- 四支舊 e2e 改為可用 `PLAYWRIGHT_CHROMIUM_EXECUTABLE` 指定瀏覽器（容器內預裝的 chromium 與 npm 安裝的 playwright 版本不一定相符）。

## 0.7.0 - 2026-09-11

- **Google Drive 跨電腦同步**：popup 新增「Google Drive 同步」區塊，連結後可把課程資料同步到 Drive 的 `Udemy Boost` 資料夾，另一台電腦載入同一份 extension（同 key = 同 extension id）即可接續。
- 三個檔案、三種策略，刻意不共用同一招：
  - `watch-log.csv`：**集合聯集**。每列不可變，以正規化後的整列為身分，兩台同時看課也不會衝突；合併可交換且冪等。
  - `notes.md`：**entry 級合併**。每則筆記帶穩定 id 與 rev，同 id 取 rev 新者；rev 相同但內容不同時**兩則都保留**並標 `ub:conflict`，絕不替使用者挑。舊格式（只有 `<!-- lecture:N -->`）以內容決定性地算出 id，兩台機器算出來一致，不會變成重複。
  - `progress.md`：**localWins**。它是從 CSV 算出來的衍生物，同步順序固定為「先合併 CSV → 播放頁重算 → 才推上雲」，反過來會把舊資料算出的報告推上去。
- 授權用 `chrome.identity.getAuthToken` + **Chrome Extension 類型**的 OAuth client，scope 只有 `drive.file`（只能存取本 extension 自己建立的檔案）。token 由 Chrome 代管與續期，extension 不碰 token endpoint、不保存任何 secret。
- `manifest.json` 加入 `key`，把 extension id 釘死為 `fibpdpmpjgaaloabohjjoinmghdocjni`，兩台電腦才會是同一個 id（OAuth 與 Inbox 的 Origin 都依賴它）。`scripts/start.ps1` 改為直接從 manifest 推導 origin，不用再手貼。
- 選擇 Udemy 資料夾後會健檢層級：選到 `Udemy/<課程>` 或底下出現同名子資料夾時明確提示（實際踩過：路徑變成 `Udemy/<課程>/<課程>/watch-log.csv`，同步找不到檔案）。
- 設定頁加上全域錯誤攔截：未處理的錯誤與 Promise rejection 一律顯示在畫面上，不再有「按了沒反應也沒訊息」。
- 修正：「立即同步」按鈕預設 `disabled`，而啟用它的程式碼在改版中被移除，導致按鈕永遠不可按且點擊被靜默吞掉。已加契約測試釘住。
- PowerShell 腳本改存 UTF-8 **with BOM**：Windows PowerShell 5.1 對無 BOM 的 `.ps1` 以 ANSI(Big5) 解讀，中文全部亂碼並引發 parser error。
