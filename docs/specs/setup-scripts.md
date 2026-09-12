# Spec: 一鍵安裝與啟動腳本（Windows PowerShell / macOS Bash）

狀態：已實作（2026-09-11），**未在 Windows 實機驗證**。
日期：2026-09-11

## 目標

把 Udemy Boost 完整鏈路需要的本機工具，用兩支可重跑的 PowerShell 腳本裝齊與啟動：

- `scripts/install.ps1`：只安裝與檢查，不常駐。可重複執行且無副作用累積（idempotent）。
- `scripts/install.sh`：macOS 版本；缺少 Conda 時以 `brew install --cask miniconda` 安裝 Miniconda；可選擇用 `--start-inbox --extension-origin` 啟動登入期間的本機 Inbox。
- `scripts/start.ps1`：只啟動服務，不安裝。每天要用的那一支。

涵蓋四條鏈路（使用者確認）：Anki 鏈路、LibreTranslate、測試依賴、環境檢查與 extension 指引。

## 非目標

- 不自動安裝 Anki 桌面程式、不自動安裝 AnkiConnect 附加元件（需要 GUI 操作與重啟 Anki）——只偵測並印出步驟。
- 不自動安裝 Node、conda、Chrome——只偵測版本並在缺少時印出官方下載指引後中止。
- 不自動登入 codex / claude CLI，不保存任何 API key。
- 不自動載入 Chrome extension（`chrome://extensions` 無法由腳本操作）——只印步驟與待貼的 Origin 位置。
- 不寫入 `.env`、不碰憑證、不改 git 設定、不自動 commit / push。
- 不做 uninstall／清除；不刪除任何既有 conda environment。

## 檔案與位置

```
udemy-boost/scripts/install.ps1
udemy-boost/scripts/install.sh
udemy-boost/scripts/start.ps1
udemy-boost/scripts/lib/common.ps1   # 共用：版本檢查、port 檢查、輸出格式、Require/Warn
```

`anki-mcp-server` 位置預設 `..\anki-mcp-server`（與 udemy-boost 同層），可用 `-ServerDir` 覆寫。

## install.ps1

參數：`-ServerDir <path>`、`-CondaEnv <name>`（預設 `libretranslate`）、`-SkipLibre`、`-SkipTests`、`-DryRun`。

步驟（任一步失敗即停，印出可操作訊息與修法）：

1. **先決條件檢查**（只讀）：Node ≥ 20.11（anki-mcp-server 的 engines）、pnpm（缺少時提示 `corepack enable pnpm`）、conda、Chrome 是否存在。
2. **anki-mcp-server**：`pnpm install --frozen-lockfile`（失敗退回 `pnpm install`）→ `pnpm run build` → 確認 `dist\index.js` 存在。
3. **udemy-boost 測試依賴**：`pnpm add -D playwright` → `pnpm exec playwright install chromium`。
4. **LibreTranslate**（`-SkipLibre` 可跳過）：environment 不存在才 `conda create -n <env> python=3.11 pip -y`；接著
   `conda run -n <env> python -m pip install --upgrade libretranslate`。沿用 `docs/libretranslate-setup.md` 的做法，不改既有 env。
5. **自我驗證**（`-SkipTests` 可跳過）：`npm test`（期望 327 pass）→ `node tests\e2e\run.mjs` → `node tests\e2e\anki-popup.mjs`。
   任一非零離開碼即視為安裝失敗並回報，不吞錯。
6. **人工步驟清單**：印出 Anki + AnkiConnect（附加元件代碼 2055492159、需重啟 Anki）、載入未封裝 extension、
   把 popup 顯示的 `chrome-extension://<id>` 交給 `start.ps1` 的 `-ExtensionOrigin`。

## start.ps1

參數：`-ExtensionOrigin <chrome-extension://...>`（必要，除非 `-SkipInbox`）、`-ServerDir`、`-CondaEnv`、
`-SkipLibre`、`-SkipInbox`、`-Foreground`。

步驟：

1. **port 檢查**：8765（AnkiConnect，應由 Anki 提供）、8766（Inbox listener，必須空著）、5000（LibreTranslate）。
   8766 被占用時**不強制 kill**，印出占用的 PID 與 process 名稱後中止，等使用者決定。
2. **AnkiConnect 探測**：`POST http://127.0.0.1:8765 {"action":"version","version":6}`；不通只警告不中止
   （可以先跑 Inbox，稍後再開 Anki）。
3. **啟動 LibreTranslate**：`conda run -n <env> libretranslate --load-only en,zh`，新視窗。
   輪詢 `GET /languages` 最多 120 秒，成功印出可用語言數。
4. **啟動 anki-mcp-server inbox listener**：`node <ServerDir>\dist\index.js`，環境變數只設
   `UDEMY_EXTENSION_ORIGIN`；新視窗。輪詢 token 檔（`<ServerDir>\inbox\pairing-token.txt`）與 8766 可連線，
   最多 30 秒。
5. **印出配對資訊**：token **檔案路徑**（不是 token 內容），提示在 popup「配對 token」欄位貼上。
6. `-Foreground` 時改為在目前視窗跑 Inbox listener（Ctrl+C 結束），LibreTranslate 仍另開視窗。

## 輸出契約

- 每一步固定格式：`[ok] / [skip] / [warn] / [fail] <步驟名> — <細節>`。
- 結尾印摘要表：每條鏈路的狀態 + 下一步人工動作。
- **不得印出 pairing token、API key 或任何憑證內容**，只印路徑。
- 任何失敗都保留原始命令與離開碼，不用 `2>$null` 吞掉。

## 邊界條件

- 重跑 install：既有 conda env 不重建、已 build 的 dist 仍重 build（便宜且避免舊 build）、playwright 已裝則跳過下載。
- 沒有網路：pip / pnpm / playwright download 會失敗 → `[fail]` 並指出是網路步驟。
- conda 不在 PATH（只在 Anaconda Prompt 有）：偵測不到就印出「請在 Anaconda Prompt 執行，或 `conda init powershell`」後中止該鏈路，不中止其餘。
- 執行原則（PowerShell）：`$ErrorActionPreference = "Stop"`、外部命令逐一檢查 `$LASTEXITCODE`。
- 腳本不得要求系統管理員權限。

## 依賴宣告（需要你裁決）

`pnpm-lock.yaml` 目前宣告 `playwright ^1.63.0`，但 `package.json` 沒有這個欄位（是被覆寫掉的）。
你的指示是「如果不影響運行就刪掉」：extension 本體零 runtime 依賴，**刪掉 lock 不影響 extension 執行**，
只影響 e2e 的版本鎖定。所以先刪除該 lock（device 端無刪除權限 → 移到 `_to_delete\` 由你清掉）。

但 `install.ps1` 執行 `pnpm add -D playwright` 之後，`package.json` 與 `pnpm-lock.yaml` 會被重新產生。
兩個選項：

- **(a) 正式宣告**：把 `devDependencies.playwright` 與 lock 一起 commit。好處是 e2e 版本可重現、
  install 腳本只要 `pnpm install`；代價是專案不再「零依賴」。
- **(b) 視為本機痕跡**：`.gitignore` 加上 `pnpm-lock.yaml`，`package.json` 的 devDependencies 不進版控
  （需要每次 install 腳本自己加）。好處是 repo 乾淨；代價是 playwright 版本浮動，
  容器／CI 上可能再次遇到「預裝瀏覽器與 playwright 版本不符」那個問題。

我的看法：(a) 較穩，因為 0.6.0 這次就是被版本不符絆到；但這是依賴宣告，照規矩由你決定。

## 驗收標準

1. 乾淨機器（已有 Node / conda / Chrome / Anki）跑 `install.ps1` 一次 → 三個鏈路皆 `[ok]`，測試全綠。
2. 重跑 `install.ps1` → 不重建 conda env、不重複下載瀏覽器、結果仍全綠。
3. `start.ps1 -ExtensionOrigin ...` → 5000 與 8766 皆可連線，popup 測試連線成功。
4. 8766 已被占用時 → `[fail]` 並印出占用者 PID，未 kill 任何 process。
5. 缺 AnkiConnect → `[warn]` 但 Inbox 仍啟動；popup 送出可用，只有同步按鈕會失敗並顯示原因。
6. 任一失敗步驟都能從輸出看出「哪一條命令、離開碼多少、怎麼修」。

## 與規格的偏離（實作時的決定）

- 原規格寫「任一步失敗即停」。實作改為：**只有先決條件失敗才硬停**，其餘採鏈路級——
  某條鏈路失敗不影響其他鏈路，最後由摘要表與非 0 離開碼表示。理由：一次跑完能看到全部問題，
  比修一個跑一次快。
- `start.ps1` 也加了 `-DryRun`（原規格只寫在 install）。
- `Start-Process -Environment` 需要 PowerShell 7.4+，Windows PowerShell 5.1 沒有；改成設定行程環境變數
  讓子行程繼承再還原，兩種 shell 都可跑。

## 驗證限制（誠實聲明）

已驗（在雲端容器的 PowerShell 7.4.6 / Linux 上實跑）：

- 三個檔案 `[Parser]::ParseFile` 無語法錯誤。
- `install.ps1 -DryRun`：印出全部將執行的命令；偵測到 Node v22.22.2、pnpm 10.28.0、缺 conda / Chrome 時降級成 warn；
  找不到 `../anki-mcp-server` 時該鏈路 fail 而其他鏈路照跑；離開碼 1。
- `start.ps1 -DryRun`：缺 `-ExtensionOrigin` → 離開碼 2；Origin 格式錯 → 離開碼 2；
  `-SkipInbox -SkipLibre` → 離開碼 0；port 檢查、AnkiConnect 探測、token 路徑輸出皆如契約。

**未驗**（我這裡沒有 Windows）：`Get-NetTCPConnection` 的實際 port 偵測、`Start-Process` 開新視窗、
conda / pnpm / Anki 的真實行為、Windows PowerShell 5.1 的相容性。這些要你在 Windows 上先跑 `-DryRun` 才算數。
