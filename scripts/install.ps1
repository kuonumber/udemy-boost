<#
.SYNOPSIS
  一次裝齊 Udemy Boost 完整鏈路需要的本機工具（只安裝與檢查，不常駐）。

.DESCRIPTION
  四條鏈路：先決條件、anki-mcp-server、測試依賴（playwright）、LibreTranslate（conda）。
  最後跑測試當作安裝後自我驗證，並印出必須人工完成的步驟。
  可重複執行：既有 conda environment 不重建、已存在的瀏覽器不重下載。

  不做的事：不安裝 Anki / AnkiConnect / Node / conda / Chrome（只偵測並給指引）、
  不碰 .env 或任何憑證、不 commit、不 push、不刪除任何 environment。

.EXAMPLE
  .\scripts\install.ps1 -DryRun
  只印出將執行的每一條命令，不動任何東西。第一次請先跑這個。

.EXAMPLE
  .\scripts\install.ps1
  實際安裝。

.EXAMPLE
  .\scripts\install.ps1 -SkipLibre -SkipTests
  只處理 anki-mcp-server 與測試依賴。
#>
[CmdletBinding()]
param(
    [string]$ServerDir,
    [string]$CondaEnv = 'libretranslate',
    [switch]$SkipLibre,
    [switch]$SkipTests,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')

$Root = Split-Path -Parent $PSScriptRoot
if (-not $ServerDir) { $ServerDir = Join-Path (Split-Path -Parent $Root) 'anki-mcp-server' }

Write-Host "Udemy Boost 安裝腳本$(if ($DryRun) { '（DryRun：只印不做）' })" -ForegroundColor Cyan
Write-Host "  udemy-boost      : $Root"
Write-Host "  anki-mcp-server  : $ServerDir"
Write-Host "  conda env        : $CondaEnv"
Write-Host ''

# ---------- 1. 先決條件（只讀） ----------
$C = '1 先決條件'
$fatal = $false

$node = Get-NodeVersion
if (-not $node) {
    Add-Result -Chain $C -Status 'fail' -Name 'Node.js' -Detail '找不到 node。請安裝 Node LTS：https://nodejs.org/'
    $fatal = $true
}
elseif ($node -lt [version]'20.11.0') {
    Add-Result -Chain $C -Status 'fail' -Name 'Node.js' -Detail "目前 $node，anki-mcp-server 要求 >= 20.11.0"
    $fatal = $true
}
else {
    Add-Result -Chain $C -Status 'ok' -Name 'Node.js' -Detail "v$node"
}

if (Test-Cmd 'pnpm') {
    Add-Result -Chain $C -Status 'ok' -Name 'pnpm' -Detail (& pnpm --version)
}
else {
    Add-Result -Chain $C -Status 'fail' -Name 'pnpm' -Detail '找不到 pnpm。請執行：corepack enable pnpm'
    $fatal = $true
}

if ($SkipLibre) {
    Add-Result -Chain $C -Status 'skip' -Name 'conda' -Detail '-SkipLibre'
}
elseif (Test-Cmd 'conda') {
    Add-Result -Chain $C -Status 'ok' -Name 'conda' -Detail ((& conda --version) -join '')
}
else {
    Add-Result -Chain $C -Status 'warn' -Name 'conda' -Detail 'PATH 找不到 conda。請改在 Anaconda Prompt 執行，或先 conda init powershell；LibreTranslate 鏈路會被跳過'
    $SkipLibre = $true
}

$chrome = Find-Chrome
if ($chrome) { Add-Result -Chain $C -Status 'ok' -Name 'Chrome' -Detail $chrome }
else { Add-Result -Chain $C -Status 'warn' -Name 'Chrome' -Detail '找不到 chrome.exe；e2e 會改用 playwright 自帶的 chromium' }

if (-not (Test-Path (Join-Path $Root 'manifest.json'))) {
    Add-Result -Chain $C -Status 'fail' -Name 'udemy-boost 路徑' -Detail "$Root 底下沒有 manifest.json"
    $fatal = $true
}

if ($fatal) {
    Write-Host ''
    Write-Host '先決條件未滿足，停止。' -ForegroundColor Red
    exit (Show-Summary -Title '安裝摘要')
}

# ---------- 2. anki-mcp-server ----------
$C = '2 anki-mcp-server'
if (-not (Test-Path $ServerDir)) {
    Add-Result -Chain $C -Status 'fail' -Name '找不到 server 目錄' -Detail "$ServerDir（可用 -ServerDir 指定）"
}
else {
    $ok = Invoke-Step -Chain $C -Name 'pnpm install --frozen-lockfile' -File 'pnpm' `
        -Arguments @('install', '--frozen-lockfile') -WorkDir $ServerDir -DryRunMode:$DryRun
    if (-not $ok -and -not $DryRun) {
        Add-Result -Chain $C -Status 'warn' -Name 'frozen-lockfile 失敗' -Detail '退回 pnpm install'
        $ok = Invoke-Step -Chain $C -Name 'pnpm install' -File 'pnpm' `
            -Arguments @('install') -WorkDir $ServerDir -DryRunMode:$DryRun
    }
    if ($ok) {
        $ok = Invoke-Step -Chain $C -Name 'pnpm run build' -File 'pnpm' `
            -Arguments @('run', 'build') -WorkDir $ServerDir -DryRunMode:$DryRun
    }
    if ($ok -and -not $DryRun) {
        $dist = Join-Path $ServerDir 'dist\index.js'
        if (Test-Path $dist) { Add-Result -Chain $C -Status 'ok' -Name 'dist\index.js' -Detail $dist }
        else { Add-Result -Chain $C -Status 'fail' -Name 'dist\index.js' -Detail "build 之後仍不存在：$dist" }
    }
}

# ---------- 3. 測試依賴（playwright） ----------
$C = '3 測試依賴'
if ($SkipTests) {
    Add-Result -Chain $C -Status 'skip' -Name 'playwright' -Detail '-SkipTests'
}
else {
    # 注意：pnpm add 會改動 package.json 與 pnpm-lock.yaml。
    # 「playwright 要不要正式進 devDependencies」這個依賴宣告尚未裁決，見 docs/specs/setup-scripts.md。
    Add-Result -Chain $C -Status 'warn' -Name '會改動 package.json / pnpm-lock.yaml' `
        -Detail 'pnpm add -D playwright 的副作用；依賴宣告尚未裁決（docs/specs/setup-scripts.md）'
    $ok = Invoke-Step -Chain $C -Name 'pnpm add -D playwright' -File 'pnpm' `
        -Arguments @('add', '-D', 'playwright') -WorkDir $Root -DryRunMode:$DryRun
    if ($ok -and -not $chrome) {
        # 有系統 Chrome 時 fixtures 會優先用它，不必下載；沒有才需要 playwright 的 chromium
        [void](Invoke-Step -Chain $C -Name 'playwright install chromium' -File 'pnpm' `
                -Arguments @('exec', 'playwright', 'install', 'chromium') -WorkDir $Root -DryRunMode:$DryRun)
    }
    elseif ($ok) {
        Add-Result -Chain $C -Status 'skip' -Name 'playwright install chromium' -Detail '有系統 Chrome，e2e 會直接用它'
    }
}

# ---------- 4. LibreTranslate（conda） ----------
$C = '4 LibreTranslate'
if ($SkipLibre) {
    Add-Result -Chain $C -Status 'skip' -Name 'conda environment' -Detail '-SkipLibre 或找不到 conda'
}
else {
    $envExists = $false
    if (-not $DryRun) {
        try {
            $list = & conda env list
            $envExists = @($list | Where-Object { $_ -match "^\s*$([regex]::Escape($CondaEnv))\s" }).Count -gt 0
        }
        catch {
            Add-Result -Chain $C -Status 'warn' -Name 'conda env list' -Detail $_.Exception.Message
        }
    }
    if ($envExists) {
        Add-Result -Chain $C -Status 'skip' -Name "conda create -n $CondaEnv" -Detail '環境已存在，不重建'
    }
    else {
        [void](Invoke-Step -Chain $C -Name "conda create -n $CondaEnv python=3.11" -File 'conda' `
                -Arguments @('create', '-n', $CondaEnv, 'python=3.11', 'pip', '-y') -DryRunMode:$DryRun)
    }
    [void](Invoke-Step -Chain $C -Name 'pip install --upgrade libretranslate' -File 'conda' `
            -Arguments @('run', '-n', $CondaEnv, 'python', '-m', 'pip', 'install', '--upgrade', 'libretranslate') `
            -DryRunMode:$DryRun)
}

# ---------- 5. 安裝後自我驗證 ----------
$C = '5 自我驗證'
if ($SkipTests) {
    Add-Result -Chain $C -Status 'skip' -Name '測試' -Detail '-SkipTests'
}
else {
    [void](Invoke-Step -Chain $C -Name 'npm test（期望 327 pass）' -File 'npm' `
            -Arguments @('test') -WorkDir $Root -DryRunMode:$DryRun)
    foreach ($suite in @('run.mjs', 'anki-popup.mjs')) {
        [void](Invoke-Step -Chain $C -Name "e2e $suite" -File 'node' `
                -Arguments @("tests\e2e\$suite") -WorkDir $Root -DryRunMode:$DryRun)
    }
}

# ---------- 6. 人工步驟 ----------
Add-NextStep '開啟 Anki，工具 → 附加元件 → 取得附加元件，搜尋安裝 AnkiConnect，然後重新啟動 Anki。'
Add-NextStep "Chrome 開 chrome://extensions → 開發人員模式 → 載入未封裝項目 → 選 $Root"
Add-NextStep '點工具列的 Udemy Boost 圖示，複製「GPT → Anki」區塊最上方的 chrome-extension://<id>。'
Add-NextStep ".\scripts\start.ps1 -ExtensionOrigin 'chrome-extension://<id>' 啟動 LibreTranslate 與 Inbox listener。"
Add-NextStep '若要用自架 LibreTranslate：popup 翻譯來源選「自架 LibreTranslate」後，按一次「授權此網址」（0.6.0 起必要）。'

exit (Show-Summary -Title '安裝摘要')
