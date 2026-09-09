# ADR 0004: 學習歷程以本地計量為主、Udemy 完成清單為權威

日期：2026-09-04　狀態：已採納

## 脈絡

Jimmy 要每門課一份 progress.md：完成的章節、每章花費時間、何時完成。實測 Udemy progress API 只給 `completed_lecture_ids`，沒有時間資訊。

## 決策

1. 「是否完成」完全跟 Udemy 的 `completed_lecture_ids`（每 30 秒 + 講次切換 + 影片結束時同步），extension 不自行判定，避免與 Udemy 頁面不一致。
2. 「何時完成」= extension 觀察到 id 從無到有的當下；安裝前已完成者標「（安裝前）」，不猜時間。
3. 「花費時間」= 本地牆鐘計量：影片播放中 + 分頁可見 + 3 分鐘內有輸入活動，每秒 +1s；每 10 秒 flush 到 `chrome.storage.local`（key `lp:<courseId>`）。
4. md 產生走既有的 downloads 通道（`downloadText` → `onDeterminingFilename` 強制路徑，overwrite），與補充資源同目錄。自動更新預設關（Chrome 每次會跳下載提示）。
5. 報表邏輯（`buildReport` / `renderMarkdown`）純函式，時區以參數注入，測試用 Asia/Taipei 快照。

## 替代方案

- 用 Udemy 的 `last_watched_second` 推算時間：API 500，且只反映影片進度不是花費時間。
- 監聽 Udemy 頁面的「完成」勾勾 DOM：class 帶 hash、改版即壞；API 穩定得多。
- 用 `chrome.alarms` 在 background 計時：content script 才知道影片狀態，沒必要繞。
- 直接寫檔到使用者指定目錄：extension 沒有 File System Access 到任意路徑，downloads API 是唯一通道。

## 後果

- 兩個分頁同時開同一講會重複計時（接受，罕見）。
- 3 分鐘閒置後才停計，最多多算 3 分鐘。
- 新增 storage 用量每講約 150 bytes，不做淘汰。
- e2e 加入：假 progress API + 真影片播 3.4 秒 → `watchedMs` 落在 2–4 秒、匯出的 md 內容比對。
