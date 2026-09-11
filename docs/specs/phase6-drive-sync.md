# Spec: Phase 6 — 筆記與觀看資料的 Google Drive 跨電腦同步

狀態：**待確認**，未實作。
日期：2026-09-11

## 需求（使用者確認）

- 跨電腦同步目前所有本地 md / csv。
- **兩邊都能編、要合併**（不是單向鏡像）。
- 可自建 GCP OAuth client。
- `watch-log.csv` 也要上 Drive。

## 先講一個實測結果：Google Doc 不能當真相來源

2026-09-11 用 Drive API 實測（建立 → 讀回）。輸入是一份典型的 `notes.md`，輸出：

| 輸入 | 讀回 |
| --- | --- |
| `<!-- lecture:52212451 -->` | **整行消失** |
| `## 01. Intro \| 02. Interface` | `## 01\. Intro \| 02. Interface` |
| 表頭 `\| 欄位 \| 值 \|` | 多出一列空表頭，內容變成 `\*\*欄位\*\*` |
| `` `G` 移動 `` | `G 移動`（inline code 反引號消失） |

結論：md → Google Doc → md 的來回轉換**會遺失資料並注入跳脫字元**。最致命的是 HTML 註解被吃掉——
`<!-- lecture:<id> -->` 正是目前 notes.md 標記歸屬的方式，也是合併時的 key。

同一支 API 加上 `disableConversionToGoogleType: true` 建立 `text/markdown` 檔案則保留原始 mime
（實測回傳 `"mimeType":"text/markdown"`, `"fileExtension":"md"`），檔案位元不被改寫。

（兩個測試檔都已移到你 Drive 的垃圾桶。）

## 決策

1. **同步載體是 Drive 上的原始檔案**（`text/markdown`、`text/csv`，皆 `disableConversionToGoogleType`），
   不是 Google Doc。兩台電腦的 extension 都讀寫同一份檔案，合併在本機做。
2. **Google Doc 只做可讀鏡像**（選配，預設關）：同步完成後把 `progress.md` 轉一份 Doc 供手機 / 網頁閱讀。
   鏡像是單向的，在 Doc 上編輯會被下次同步覆蓋，UI 要明講。
3. **`progress.md` 不參與合併**：它是從 CSV 產生的衍生物，同步後在本機重算。

> 若你真的要「在 Google Docs 網頁上編筆記」，那是另一條路（見「延後：Doc 原生編輯」），
> 需要一個跳脫正規化器與可見式 entry marker，且仍有腐爛風險。先不做。

## 資料模型與合併規則

### watch-log.csv — grow-only set（無衝突）

- 每列的身分 = `sha256(正規化後的整列)`。列一旦寫出就不可變。
- 合併 = 兩邊聯集，依 `start` 排序輸出。重複列自動去除。
- 這是真正的 CRDT，兩台機器同時看課也不會衝突。

### notes.md — entry 集合，欄位 LWW

- 現行格式的 `<!-- lecture:<id> -->` 不足以定位單則筆記（同一講可多則）。
  **新增穩定 id**：`<!-- ub:note id=<uuid> at=<ISO> rev=<ISO> -->`，舊檔在第一次同步時遷移
  （依 lectureId + 時間戳產生決定性 uuid v5，不會因為重跑而改變）。
- 合併 = 以 id 為 key 的聯集；同 id 兩邊都改 → 取 `rev` 較新者；`rev` 相同但內容不同 → 兩則都保留，
  後者標 `<!-- ub:conflict -->` 並在 popup 提示（**不靜默丟棄任何人寫的字**）。
- 刪除 = tombstone（`<!-- ub:note id=... deleted=<ISO> -->`），避免「A 刪除、B 同步後復活」。

### progress.md — 衍生

同步後以合併完的 CSV 重算。Drive 上那份只是最新產生結果。

## 同步狀態

本機 `Udemy/.ub-sync.json`（不進版控、不含 token）：

```json
{
  "schemaVersion": 1,
  "deviceId": "<uuid，首次產生>",
  "files": {
    "<課程>/watch-log.csv": {
      "fileId": "...", "remoteModifiedTime": "...", "remoteMd5": "...",
      "lastMergedLocalHash": "...", "lastSyncAt": "..."
    }
  }
}
```

同步一個檔的流程：

1. `files.get` 取 `modifiedTime` / `md5Checksum`。
2. 遠端與 `remoteMd5` 相同且本地 hash 未變 → `[skip]`。
3. 只有一邊變 → 單向複製。
4. 兩邊都變 → 下載遠端 → 依上述規則合併 → 寫回本地 → 以
   `If-Match: <etag>` 上傳（412 就重跑整個流程，最多 3 次）。

## OAuth 與權限

- `chrome.identity.launchWebAuthFlow` + **PKCE**，redirect 為 `https://<extension-id>.chromiumapp.org/`。
- scope 只要 **`https://www.googleapis.com/auth/drive.file`**：只能存取「這個 app 自己建立的檔案」，
  碰不到你 Drive 的其他東西。
- manifest 加 `"key"` 固定 extension id（否則每次重新載入 id 會變，OAuth client 對不上）；
  新增 `identity` 權限與 `https://www.googleapis.com/*`、`https://oauth2.googleapis.com/*` host permission。
- token 存 `chrome.storage.local`（content script 讀不到，但比 session 持久）；**不寫進任何檔案或 log**。
- **待驗證**：Google 對「無 client secret 的 public client」核發 refresh token 的行為我沒有實測過，
  不確定能不能長期免互動續期。備案：`launchWebAuthFlow({interactive: false})` 靜默續期，
  失敗才要求你按一次「重新授權」。這一項要先用你的 GCP client 做實驗才能定案，**不會寫死在規格裡假裝可行**。

## 觸發時機

- popup「立即同步」按鈕（一律可用）。
- 講次完成後（沿用既有 `onCompleted`）。
- `chrome.alarms` 每 15 分鐘（可關）。
- 每次同步都寫一行到 popup 的狀態區：同步了哪些檔、幾列被合併、有無衝突。

## 非目標

- 不同步字幕、不同步下載的課程資源（體積大且可重新取得）。
- 不做即時協作（沒有 websocket、沒有 operational transform）。
- 不支援 Google 帳號以外的儲存（OneDrive / Dropbox 之後再說）。
- 不在 Doc 上做原生編輯（見下）。
- 不自動處理「同一台電腦多個 Chrome profile」的情境。

## 延後：Doc 原生編輯

若之後真的要在 Google Docs 網頁編筆記，需要：

1. entry marker 改成看得見、且經過 Doc 轉換仍存活的形式（例如 `### ⟦ub:note:abc123⟧`）。
2. 一個跳脫正規化器（把 Doc 吐回來的 `01\.`、`\*\*x\*\*` 還原），並以 round-trip 測試釘住
   「md → Doc → md → Doc 穩定不變」。
3. 接受表格與 inline code 會被改寫。

先做檔案同步；這一段等檔案同步穩了再評估。

## 測試計畫（先寫測試再實作）

純函式（`npm test`）：

- CSV 合併：空 / 單邊空 / 完全重疊 / 部分重疊 / 亂序 / 重複列 / 壞行 / 不同 extVersion / 跨時區時間戳。
- notes 合併：新增、雙邊編輯同一則（rev 新舊、rev 相同內容不同）、刪除 tombstone、
  舊格式遷移的決定性（同輸入跑兩次 uuid 必須相同）、entry 順序穩定。
- 同步決策表：四種變更組合（皆未變 / 只本地 / 只遠端 / 兩邊）× 首次同步 / 已同步。
- Drive client：401 / 403 / 404 / 412（etag 衝突）/ 429（退避）/ 5xx / 非 JSON 回應 / 逾時。

e2e：以假的 Drive endpoint（瀏覽器層 route，如同 `anki-popup.mjs` 的做法）跑
「兩台裝置」情境——同一份 CSV 在兩個 profile 各加幾列，同步後兩邊內容一致且無重複列。

真實 Drive：需要你的 OAuth client，屬人工驗證，**不以 mock 宣稱已可用**。

## 驗收標準

1. 兩台電腦各看一段課 → 各自同步 → 兩邊 `watch-log.csv` 列數與內容完全一致，無重複。
2. 兩台各寫一則筆記 → 同步 → 兩則都在，順序依時間。
3. 同一則筆記兩邊都改 → 同步 → 較新者勝，較舊者以 conflict 區塊保留，popup 有提示。
4. 斷網 → 所有操作照常寫本地檔，恢復後同步成功。
5. 撤銷 Drive 授權 → extension 回到純本地模式，不遺失任何本地資料。
6. `drive.file` scope 之外的檔案完全不可見（以 API 實測確認）。

## 分期

- **6a**：OAuth + Drive client + CSV 同步（無衝突那半）。
- **6b**：notes 的 id 遷移與 entry 級合併 + 衝突提示。
- **6c**（選配）：progress.md 的 Google Doc 唯讀鏡像。

建議一期一期來，6a 跑穩了再動 6b。
