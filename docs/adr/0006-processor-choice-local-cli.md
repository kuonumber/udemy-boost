# ADR 0006: 由使用者選擇 Codex 或 Claude 作為本機處理工具

日期：2026-09-07　狀態：已採納

## 脈絡

ADR 0005 的第一版把 Inbox item 留在 `pending`，等使用者到 Codex 對話中手動呼叫 `udemy_inbox_*` tools。實際使用時 popup 停在「等待處理」，使用者不知道下一步在哪裡；同時使用者要求能在 Codex 與 Claude 之間選擇處理資料的工具。

## 決策

- popup 新增「處理工具」選項（`ankiProcessor`：`codex`／`claude`），隨學習包一起送到本機 server（request 的 `processor` 欄位，可省略）。
- 擁有 8766 listener 的 server instance 在 item 建立後，用該工具的**本機 CLI**（`codex exec` 或 `claude -p`，使用者自己的登入）產生卡片，經同一套 validator 後進入 `review_ready`；popup 既有的輪詢會直接收到草稿。失敗（usage limit、非法 JSON、逾時）進 `failed` 並在 popup 顯示原因。
- 省略 `processor` 的 item 維持原本的手動 MCP 流程；兩條路徑共用 store、validator 與 Anki 人工確認 gate。
- CLI 命令可用 `UDEMY_PROCESSOR_CODEX_CMD`／`UDEMY_PROCESSOR_CLAUDE_CMD`（JSON 陣列）覆寫，供測試注入假 CLI，也讓使用者換模型參數。

## 替代方案

- 背景 heartbeat 讓 Codex 對話自動輪詢 inbox：需要常駐對話，且無法讓使用者選工具。
- extension 直接呼叫 OpenAI／Anthropic API：需保存雲端 API key，違反既有隱私設計。
- 由 extension 啟動 CLI：Chrome extension 無法啟動本機程序；Native Messaging 成本高。

## 後果

- 字幕會透過使用者選的 CLI 送到該廠商模型——這與原本「Codex 透過 MCP 讀取 item」在資料流向上相同，仍只在按下按鈕後發生，且不新增任何 API key。
- server 子程序的 stderr 只保留診斷行（Codex 會把整段 prompt 回印到 stderr），避免字幕進入 item 狀態或 log。
- Codex／Claude 各自啟動的 server instance 中，只有擁有 listener 的那個會執行 processor；另一個仍可提供 MCP tools。
- 兩個 CLI 都要能在使用者 PATH 上被找到；`codex exec` 需要 Codex 額度，用量不足時 item 會標 `failed`，使用者可換另一個工具重送。
