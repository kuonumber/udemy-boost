# ADR 0007: 學習資料以磁碟上的 CSV 為真相來源，經 File System Access API 直寫

日期：2026-09-09　狀態：已採納

## 脈絡

Phase 4 把觀看記錄放 `chrome.storage`、用 downloads API 產 md。Jimmy 要「重裝 / 換機不歸零、已有的 md 要延續、原始數據存 CSV 定期分析」。downloads 只能寫不能讀、每次跳提示，做不到。

## 決策

1. 使用者在設定頁選一次 `Downloads/Udemy`（`showDirectoryPicker`），handle 存 IndexedDB；所有讀寫由 offscreen document 執行（extension origin、有 DOM、可用 `createWritable`）。content script 經 background 轉送。
2. `watch-log.csv` 追加式、一行一個觀看段，是唯一真相；`progress.md` 每次由 CSV + Udemy 完成清單重算；`notes.md` 追加式。`chrome.storage` 只剩暫存佇列與今日分鐘數。
3. 第一次遇到舊格式 `progress.md` → 備份 `.bak.md`，解析後連同 Phase 4 storage log 以 `imported` / `completed` 行併入 CSV。
4. 未連結資料夾時完全退回 Phase 4 行為；寫失敗排佇列，授權後補寫。
5. 分析（分心、專注比、回看、session、時段、週趨勢）全是純函式，時區注入。

## 替代方案

- 繼續用 downloads + 解析 md 當狀態：讀不到檔案，走不通。
- OPFS（extension 私有儲存）：重裝仍會清掉，且使用者看不到檔案；只拿來當 e2e 的假資料夾。
- 在 service worker 直接寫檔：headless 下 OPFS 的 `createWritable` 存在，但 user-picked handle 在 SW 的權限與 API 支援不確定；offscreen 是文件明載可行的路。
- Native Messaging 寫檔：要另裝 host 程式，過重。

## 後果

- 多一個 `offscreen` 權限與一個常駐隱藏頁（閒置時 Chrome 會回收，事件到再拉起）。
- 資料夾授權是否跨瀏覽器重啟持續，取決於 Chrome 的持續授權行為，需 Jimmy 實機確認；不持續就每次開瀏覽器按一次「重新授權」，期間資料不會丟（佇列）。
- 舊 md 只靠（章, 講）索引對回 lectureId；講師重排課綱會對錯，匯入摘要會列出對不到的筆數。
- 兩個分頁同時看同一講會產生重疊段；分析合併重疊區間，不重複計時。
