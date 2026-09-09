# ADR 0008: host_permissions 只留 udemy.com 與 AnkiConnect，其餘位址走 optional permission

日期：2026-09-09　狀態：已採納

## 脈絡

0.5.x 的 manifest 帶著 `http://localhost/*` 與 `http://127.0.0.1/*` 兩個寬 host permission，原因只是 Phase 2 的自架 LibreTranslate 預設跑在 `localhost:5000`。

那兩條規則的實際範圍是「本機所有 port 的所有 HTTP 服務」。同時 Inbox listener（`127.0.0.1:8766`）刻意不要 host permission：有 host permission 時 Chrome 對 GET 不送 `Origin` header，server 端的 Origin 配對檢查會回 403，所以它必須走標準 CORS，由 server 以精確的 extension origin 放行（`tests/anki-ui-contract.test.js` 用斷言把這件事釘住）。寬 permission 會讓這個保護失效。

## 決策

`host_permissions` 只保留兩條：

- `https://www.udemy.com/*`：字幕、curriculum、progress API。
- `http://127.0.0.1:8765/*`：AnkiConnect（POST，需要 host permission 才能從 popup 直接呼叫）。

LibreTranslate 的位址（含 `localhost`）改為 `optional_host_permissions`（已有 `http://*/*`、`https://*/*`），由設定頁的「授權此網址」按鈕在 user gesture 內 `chrome.permissions.request()`。

## 替代方案

- 維持寬 localhost permission：Inbox 的 Origin 配對保護會被繞掉，且權限範圍遠大於需要。
- 把 LibreTranslate 也固定成單一 port 寫進 manifest：使用者換 port 就要改 manifest 重載，比按一次授權更差。
- 把翻譯請求改由 background 代打：一樣需要 host permission，只是換位置，沒有解決範圍問題。

## 後果

- 首次使用自架 LibreTranslate（含 localhost）要在 popup 按一次「授權此網址」，否則 content script 連不上。這是行為變更，`isLocalhost` 的免授權捷徑已移除。
- Inbox 的「只有已配對 extension origin 能寫入」保護維持有效。
- 使用者可隨時在 `chrome://extensions` 撤銷該位址授權，不必動 manifest。
