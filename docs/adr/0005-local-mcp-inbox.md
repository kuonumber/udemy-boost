# ADR 0005: 以 localhost inbox 串接 Udemy Boost 與 Codex

日期：2026-09-07　狀態：已採納

## 脈絡

Chrome extension 無公開且穩定的介面可將內容注入目前 Codex 對話框。既有設計又要求字幕不自動外送、無雲端 API key，且 Anki 寫入保留人工確認。

## 決策

Udemy Boost 是主要操作介面，負責送出、狀態、卡片審核及最終同步。在本機 MCP server 增加綁定 `127.0.0.1` 的最小 inbox bridge；Udemy Boost 只在使用者明確按下按鈕後，以配對 token 和 extension Origin將單一單元學習包送入，Codex 再透過 MCP tools 處理佇列並把草稿交回插件。Inbox 與 Anki 寫入分離，不能繞過原有審核與備份 gate。

## 替代方案

- Chrome downloads 目錄監看：不需 HTTP server，但跨平台路徑、重名、半寫入與權限處理較複雜。
- Native Messaging：安全邊界較強，但安裝與 host manifest 維護成本高。
- Responses API：可直接自動產生卡片，但需要 API key、產生雲端用量並改變既有隱私設計。
- UI automation：能操作對話框，但 selector、焦點及版本變動使可靠度與可測性不足。

## 後果

- 需要新增 localhost port、配對 UX、CORS/Origin 防護及 inbox lifecycle。
- extension 與 MCP server 共用一份 versioned schema，必須做相容性與大小限制測試。
- 可在不新增雲端憑證下實現可追蹤的半自動流程；仍由使用者決定何時送出與何時寫入 Anki。
