# Spec: 本機 MCP Inbox 串接 Udemy 學習包

狀態：已確認，已實作（含 2026-09-07 晚間追加的處理工具選項，見 ADR 0006）。
日期：2026-09-07

## 目標

以 Udemy Boost 作為整套流程的主要操作介面。使用者在插件內選擇處理工具（Codex 或 Claude）並明確按下「送到 AI Inbox」後，插件將目前單元的 GPT 學習包傳到本機 MCP bridge；本機 server 以該工具的 CLI（`codex exec`／`claude -p`，使用者自己的登入）產生卡片草稿，回到插件內預覽、編輯、取消及確認同步。沒選工具（request 省略 `processor`）的 item 維持由 Codex／Claude 對話透過 MCP tools 手動處理。

流程：

`Udemy Boost UI（選 Codex／Claude）→ localhost MCP bridge → 該工具的本機 CLI → Udemy Boost 審核 → Anki`

### 追加契約：`processor`

- request 可帶 `processor: "codex" | "claude"`；其他值 422。item、POST 回應、GET 回應與 `udemy_inbox_list` metadata 都回傳它。
- 只有擁有 8766 listener 的 server instance 執行 processor；item 建立（非 dedup）後立即 `claim → CLI → validateCards → review_ready`，失敗 `markFailed`，原因只含診斷行（不得含字幕）。啟動時對 pending 且有 processor 的 item `resumePending`。
- 同 requestId 重送（dedup）不得重跑 processor。
- CLI 命令可由 `UDEMY_PROCESSOR_CODEX_CMD`／`UDEMY_PROCESSOR_CLAUDE_CMD`（JSON 字串陣列，`{output}` 為回答檔）覆寫；測試以假 CLI 注入。

## 非目標

- 不自動擷取後立即傳送；每次傳送都由使用者按鈕觸發。
- extension 不直接呼叫 OpenAI、Anthropic 或其他雲端 API，也不保存 API key；字幕只透過使用者選定並已登入的本機 CLI 離開本機，且只在按下送出後。
- 不注入或操控目前 Codex 對話框 UI。
- 不在 extension 或 repository 內保存 API key、固定密碼或其他可公開使用的憑證。
- 第一版不做多裝置同步、遠端 MCP、批次整章／整課傳送。
- 不自動 commit 或 push。

## 元件與責任

### Udemy Boost extension

- 沿用 `study-pack.md` 的 exporter 與單一單元範圍。
- 提供完整操作介面：本機配對、連線狀態、送出、處理狀態、卡片預覽／編輯／取消，以及最終 Anki 同步確認。
- 只在使用者按下「送到 Codex Inbox」後執行 POST。
- 配對 token 僅存於限制為 `TRUSTED_CONTEXTS` 的 `chrome.storage.session`，不提供 content script 存取，也不寫入 log、匯出檔或 Git；瀏覽器重啟後需重新輸入。
- Codex 保存的卡片草稿由插件取回並通過相同 JSON validator；不信任 MCP 回傳內容。

### anki-mcp-server

- stdio MCP transport 維持不變，另開 localhost-only inbox listener。
- listener 預設綁定 `127.0.0.1`，不得綁定 `0.0.0.0`。
- inbox 檔案放在 server clone 內被 `.gitignore` 排除的資料目錄。
- 僅作為本機 bridge 與 Codex tool provider；不承擔主要 UI。
- MCP 提供讀取與狀態管理 tools，不直接把原始字幕回傳給其他網路服務。

## HTTP 契約

預設 endpoint：`http://127.0.0.1:8766/v1/inbox/items`。

### 認證與瀏覽器邊界

- server 首次啟動產生至少 32 bytes cryptographically secure pairing token。
- 使用者以一次性人工配對流程將 token 存進 extension；不得把 token 寫死在原始碼。
- POST 必須帶 `Authorization: Bearer <token>`。
- 驗證 `Origin` 必須為已配對的 `chrome-extension://<extension-id>`；沒有 Origin、錯誤 Origin 或 `Origin: null` 一律拒絕。
- CORS 只回應已配對 extension origin；不得使用 `Access-Control-Allow-Origin: *`。
- 只接受 `Content-Type: application/json`、POST；其餘 method 回 405。

### Request

```json
{
  "schemaVersion": 1,
  "requestId": "uuid-v4",
  "createdAt": "RFC3339 timestamp",
  "studyPack": {
    "course": {},
    "unit": {},
    "subtitles": {}
  }
}
```

- `requestId` 由 extension 產生，用於 idempotency；同一 ID 與相同內容重送回既有 item。
- 同一 ID 但內容不同回 409，不覆寫既有資料。
- request body 上限預設 5 MiB；超過回 413。
- 完整驗證 course、unit、URL、字幕 cue、時間範圍、字串長度與總 cue 數。
- server 不接受任意檔案路徑、命令、HTML 執行內容或 callback URL。

### Response

```json
{
  "schemaVersion": 1,
  "itemId": "uuid-v4",
  "requestId": "uuid-v4",
  "status": "pending",
  "deduplicated": false
}
```

狀態固定為：`pending → processing → review_ready → synced`，錯誤可轉為 `failed`；`failed` 可人工重試回 `pending`。禁止跳過 `review_ready` 直接同步。

插件另以 `GET /v1/inbox/items/<itemId>` 讀取狀態；`review_ready` 時回傳經驗證的卡片草稿。此 endpoint 同樣要求 token 與配對 Origin。

## MCP tools 契約

- `udemy_inbox_list(status?, limit?, cursor?)`：metadata-only 清單，預設不回完整字幕。
- `udemy_inbox_get(itemId)`：讀取單一學習包及目前狀態。
- `udemy_inbox_claim(itemId)`：原子地將 `pending` 改為 `processing`；已被處理時回衝突。
- `udemy_inbox_save_draft(itemId, cardsJson)`：依 `gpt-anki-cards.md` 驗證後保存草稿並改為 `review_ready`。
- `udemy_inbox_mark_failed(itemId, reason)`：保存可操作但不含字幕內容的錯誤摘要。

所有 tools 都需有明確 input/output schema 與 MCP annotations。Inbox tools 不直接呼叫 Anki；寫入仍走既有人工確認與備份機制。

## Udemy Boost 審核 UI

- popup 顯示 `pending`、`processing`、`review_ready`、`failed`、`synced` 狀態，不要求使用者切換到另一個管理頁。
- `review_ready` 後逐張顯示 Basic/Cloze 欄位、來源時間、理由、tags 與選取框。
- 使用者可直接修改文字、取消個別卡片或清除整份本機草稿；修改後重新驗證並重新計算 fingerprint。
- 「確認同步到 Anki」顯示 deck 與選取張數，經原生 `confirm()` 後才呼叫 AnkiConnect。
- 同步成功的卡片保留結果狀態；重試不得重送已成功卡片。

## 儲存與隱私

- 每個 item 使用獨立目錄及原子 rename，避免半寫入檔案。
- 保存 study pack、卡片草稿、狀態檔及 SHA-256；audit log 只記 item ID、時間、狀態與 hash，不記字幕全文或 token。
- 預設保留 30 天；第一版只提供明確的人工清除，不在啟動時自動刪除。
- 檔案權限採目前使用者可讀寫；若 Windows ACL 無法收窄則啟動時警告。
- log 與錯誤訊息必須遮蔽 Authorization header 與字幕內容。

## 錯誤與復原

- MCP server 未啟動、timeout、401/403、409、413、422、500 均顯示不同且可操作的訊息。
- extension 送出失敗時保留本機 study pack，可安全重試同一 `requestId`。
- server 寫入失敗不得留下可被列出的半成品。
- Codex 產生卡片失敗時保留原 item，不能刪除或覆寫原字幕。

## 測試順序

1. 先新增 extension client、HTTP listener、schema、idempotency、原子儲存及 MCP tools 測試。
2. 尚未實作時執行並保存 module-not-found／未支援行為的紅燈證據。
3. 實作純 schema 與 store，再做 HTTP 邊界，最後註冊 MCP tools 與 extension UI。
4. 完整測試後才做本機整合驗證；不以 mock 測試宣稱真實 Codex/Anki 已可用。

必要案例：

- 正常、空字幕、單語、5 MiB 邊界、超限、特殊字元、型別混雜及非法時間。
- 無 token、錯 token、錯 Origin、null Origin、萬用 CORS 不可出現、非 POST method。
- 相同 requestId 同內容重送、同 ID 不同內容衝突、同時 claim、程序中斷、原子寫入失敗。
- 合法／非法卡片 JSON、未知 schema、狀態非法跳轉、分頁游標錯誤。
- server 未啟動、timeout、HTTP error；失敗後 extension 草稿與 server 原 item 仍存在。
- e2e：手動送出 → MCP claim → 保存卡片草稿 → 人工審核 → 既有安全 Anki 寫入。

## 驗收標準

- 未按按鈕時沒有任何資料離開 extension。
- 非已配對 extension 無法新增 inbox item。
- 相同傳送可安全重試且不產生副本。
- Codex 可透過 MCP 完成列出、讀取、claim 與保存草稿。
- 未人工審核時不能寫入 Anki。
- 任何失敗不遺失 extension 草稿或 server 原始 item。
- 既有測試及新增測試全綠，並另列真實 extension、MCP、Codex、Anki 整合結果。

## 待確認決策

1. listener port 預設採 `8766`，可由非敏感 config 覆寫。
2. retention 採 30 天但只人工清除；自動清理延後。
3. 第一版完成插件內完整送出與審核流程，以及可由 Codex 手動呼叫的 MCP tools；固定背景 task／heartbeat 屬後續可選自動化，不影響本版驗收。

## 實作註記（0.6.0）

- extension 端的配對 / 送出 / 輪詢 / 審核 UI 在 0.6.0 重新接線（0.5.x 覆寫遺失）。
- token 讀寫只用 `chrome.storage.session`，background 以 `setAccessLevel({ accessLevel: "TRUSTED_CONTEXTS" })` 鎖住。
- 輪詢每 2 秒、最多約 5 分鐘；逾時只提示「item 仍在本機 Inbox」，不刪除任何東西。
- `review_ready` 回傳的卡片不被信任：一律以 `validateCardPackage` 重新驗證，並比對目前頁面的 course / unit metadata。
- e2e：`tests/e2e/anki-popup.mjs`（假 8766，驗 extension 端）與 `tests/e2e/inbox-bridge.mjs`（真 server，跨 repo）分開。
