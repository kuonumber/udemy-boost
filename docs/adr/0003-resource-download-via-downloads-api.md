# ADR 0003: 課程補充資源批次下載走 chrome.downloads API + background service worker

日期：2026-09-04　狀態：已採納

## 脈絡

Jimmy 要一鍵抓整門課的講師補充資源（PDF / zip / .blend）。範圍明確排除影片（Udemy ToS + Widevine DRM）與字幕。
實測 Udemy curriculum API 一次回整門課，`File` 類 asset 帶 `att-c.udemycdn.com` 簽章 URL，匿名可抓。

## 決策

1. 下載交給 `chrome.downloads.download()`（在 background service worker 呼叫），不用 content script `fetch` + Blob：
   Chrome 自己管理磁碟寫入、進度、重試、檔名衝突（`uniquify`），且 content script 不能用 downloads API。
2. content script 只負責「掃描」（需要 udemy.com cookie 的 curriculum API），產出 `Plan` 純資料送 popup → background。
3. 兩段式 UX：先掃描顯示摘要（檔數 / 總 MB / 外部連結 / 略過），確認後才開始下載。
4. 目錄結構 `Udemy/<slug>/<NN. 章>/<NN. 講>/<檔名>`；外部連結不下載，寫成 `links.md`（`data:` URL）。
5. 進度狀態存 `chrome.storage.session`，worker 被回收也不掉；read-modify-write 用 promise chain 序列化。

## 替代方案

- content script `fetch` + `<a download>`：50 個檔案會被 Chrome 視為多重下載而彈確認，且 content script 無法指定子目錄。
- `chrome.downloads` 一次全丟不限流：Chrome 內部會排隊，但 popup 顯示的「進行中」會失真；限 4 個並行。
- 用 `object_index` 排序 curriculum：實測 chapter / lecture 序號各自獨立，混排會把講次歸錯章；改為保持 API 順序。

## 後果

- 新增 `downloads`、`activeTab` 權限與 background service worker（module）。
- 簽章 URL 有時效：掃描後放很久再按下載會 interrupted，popup 有失敗清單，重掃即可。
- 已下載過再跑會產生 ` (1)` 副本（downloads API 查不到磁碟上既有檔案）。
- blender-start 全部資源約 3.0 GB / 51 檔，popup 摘要會先告知再開始。
