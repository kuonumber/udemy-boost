<#
.SYNOPSIS
  啟動 Udemy Boost 需要的本機服務（LibreTranslate 5000、anki-mcp-server Inbox 8766），不安裝任何東西。

.DESCRIPTION
  先檢查 8765 / 8766 / 5000 的占用狀況，探測 AnkiConnect，再各開一個視窗啟動服務並等它們真的可用。
  8766 被占用時不會強制結束任何 process，只印出占用者後停手。
  只印 pairing token 的「檔案路徑」，不印內容。

.EXAMPLE
  .\scripts\start.ps1 -ExtensionOrigin 'chrome-extension://abcd...' -DryRun

.EXAMPLE
  .\scripts\start.ps1 -ExtensionOrigin 'chrome-extension://abcd...'

.EXAMPLE
  .\scripts\start.ps1 -SkipInbox
  只起 LibreTranslate（例如 Inbox 已經在另一個視窗跑著）。
#>
[CmdletBinding()]
param(
    [string]$ExtensionOrigin,
    [string]$ServerDir,
    [string]$CondaEnv = 'libretranslate',
    [switch]$SkipLibre,
    [switch]$SkipInbox,
    [switch]$Foreground,
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'lib\common.ps1')

$Root = Split-Path -Parent $PSScriptRoot
if (-not $ServerDir) { $ServerDir = Join-Path (Split-Path -Parent $Root) 'anki-mcp-server' }

# extension id 由 manifest 的 "key" 決定，直接推導，不必手動貼。
# 只有在 manifest 沒釘 key（id 由資料夾路徑決定）時才需要 -ExtensionOrigin。
$originSource = 'parameter'
if (-not $ExtensionOrigin) {
    $derivedId = Get-ExtensionId -ManifestPath (Join-Path $Root 'manifest.json')
    if ($derivedId) {
        $ExtensionOrigin = "chrome-extension://$derivedId"
        $originSource = 'manifest key'
    }
}
if (-not $SkipInbox -and -not $ExtensionOrigin) {
    Write-Host "manifest.json 沒有 key，無法推導 extension id。請用 -ExtensionOrigin 指定（popup『GPT → Anki』最上方那串），或用 -SkipInbox 跳過 Inbox。" -ForegroundColor Red
    exit 2
}
if ($ExtensionOrigin -and $ExtensionOrigin -notmatch '^chrome-extension://[a-p]{32}$') {
    Write-Host "ExtensionOrigin 格式看起來不對：$ExtensionOrigin（應為 chrome-extension:// 加 32 個字母）" -ForegroundColor Red
    exit 2
}

Write-Host "Udemy Boost 啟動腳本$(if ($DryRun) { '（DryRun：只印不做）' })" -ForegroundColor Cyan
Write-Host "  anki-mcp-server : $ServerDir"
Write-Host "  conda env       : $CondaEnv"
if ($ExtensionOrigin) { Write-Host "  extension origin: $ExtensionOrigin（來源：$originSource）" }
Write-Host ''

# ---------- 1. port 檢查 ----------
$C = '1 port 檢查'
$anki8765 = Get-PortOwner -Port 8765
$inbox8766 = Get-PortOwner -Port 8766
$libre5000 = Get-PortOwner -Port 5000

if ($anki8765) { Add-Result -Chain $C -Status 'ok' -Name '8765 AnkiConnect' -Detail $anki8765 }
else { Add-Result -Chain $C -Status 'warn' -Name '8765 AnkiConnect' -Detail '沒人聽；Anki 沒開或沒裝 AnkiConnect。可以先啟動 Inbox，稍後再開 Anki' }

$blocked = $false
if ($inbox8766) {
    if ($SkipInbox) {
        Add-Result -Chain $C -Status 'skip' -Name '8766 Inbox' -Detail "已被 $inbox8766 占用（-SkipInbox）"
    }
    else {
        Add-Result -Chain $C -Status 'fail' -Name '8766 Inbox' -Detail "已被 $inbox8766 占用。請先關掉它（可能是另一個 anki-mcp-server / Claude 或 Codex 啟動的 MCP instance）再重跑；本腳本不會強制結束任何 process"
        $blocked = $true
    }
}
else {
    Add-Result -Chain $C -Status 'ok' -Name '8766 Inbox' -Detail '空著'
}

if ($libre5000) { Add-Result -Chain $C -Status 'warn' -Name '5000 LibreTranslate' -Detail "已被 $libre5000 占用；視為已在執行，將跳過啟動"; $SkipLibre = $true }
else { Add-Result -Chain $C -Status 'ok' -Name '5000 LibreTranslate' -Detail '空著' }

if ($blocked) { exit (Show-Summary -Title '啟動摘要') }

# ---------- 2. AnkiConnect 探測 ----------
$C = '2 AnkiConnect'
if ($DryRun) {
    Add-Result -Chain $C -Status 'skip' -Name 'version 探測' -Detail 'DryRun：將 POST http://127.0.0.1:8765 {"action":"version","version":6}'
}
else {
    try {
        $r = Invoke-RestMethod -Uri 'http://127.0.0.1:8765' -Method Post -ContentType 'application/json' `
            -Body '{"action":"version","version":6}' -TimeoutSec 5 -ErrorAction Stop
        if ($r.result -eq 6) { Add-Result -Chain $C -Status 'ok' -Name 'API version' -Detail '6' }
        else { Add-Result -Chain $C -Status 'warn' -Name 'API version' -Detail "回傳 $($r.result)，同步流程需要 6" }
    }
    catch {
        Add-Result -Chain $C -Status 'warn' -Name 'version 探測' -Detail "連不上：$($_.Exception.Message)。同步到 Anki 之前要開 Anki 並裝 AnkiConnect"
    }
}

# ---------- 3. LibreTranslate ----------
$C = '3 LibreTranslate'
if ($SkipLibre) {
    Add-Result -Chain $C -Status 'skip' -Name '啟動' -Detail '-SkipLibre 或 5000 已在使用'
}
elseif (-not (Test-Cmd 'conda')) {
    Add-Result -Chain $C -Status 'warn' -Name 'conda' -Detail 'PATH 找不到 conda；請在 Anaconda Prompt 執行或 conda init powershell'
}
else {
    $cmd = "conda run -n $CondaEnv libretranslate --load-only en,zh"
    if ($DryRun) {
        Add-Result -Chain $C -Status 'skip' -Name '啟動' -Detail "DryRun：將於新視窗執行 $cmd"
    }
    else {
        Start-Process -FilePath 'conda' `
            -ArgumentList @('run', '--no-capture-output', '-n', $CondaEnv, 'libretranslate', '--load-only', 'en,zh')
        Add-Result -Chain $C -Status 'ok' -Name '已送出啟動' -Detail $cmd
        $langs = Wait-HttpOk -Uri 'http://localhost:5000/languages' -TimeoutSec 120
        if ($null -eq $langs) {
            Add-Result -Chain $C -Status 'fail' -Name '/languages' -Detail '120 秒內沒有回應；第一次啟動要下載語言模型，請看它自己的視窗'
        }
        else {
            Add-Result -Chain $C -Status 'ok' -Name '/languages' -Detail "$(@($langs).Count) 種語言可用"
        }
    }
}

# ---------- 4. Inbox listener ----------
$C = '4 Inbox listener'
$tokenPath = Join-Path $ServerDir 'inbox\pairing-token.txt'
$dist = Join-Path $ServerDir 'dist\index.js'
if ($SkipInbox) {
    Add-Result -Chain $C -Status 'skip' -Name '啟動' -Detail '-SkipInbox'
}
elseif (-not (Test-Path $dist)) {
    Add-Result -Chain $C -Status 'fail' -Name 'dist\index.js' -Detail "不存在：$dist。請先跑 .\scripts\install.ps1"
}
elseif ($DryRun) {
    Add-Result -Chain $C -Status 'skip' -Name '啟動' -Detail "DryRun：將以 UDEMY_EXTENSION_ORIGIN=$ExtensionOrigin 執行 node $dist$(if ($Foreground) { '（前景）' } else { '（新視窗）' })"
}
elseif ($Foreground) {
    Add-Result -Chain $C -Status 'ok' -Name '前景執行' -Detail 'Ctrl+C 結束；token 路徑見下方'
    Add-NextStep "pairing token 檔：$tokenPath（貼進 popup 的「配對 token」欄位）"
    [void](Show-Summary -Title '啟動摘要')
    $env:UDEMY_EXTENSION_ORIGIN = $ExtensionOrigin
    & node $dist
    exit $LASTEXITCODE
}
else {
    # Start-Process 的 -Environment 要 PowerShell 7.4+；Windows PowerShell 5.1 沒有。
    # 改成先設好行程環境變數讓子行程繼承，再還原，這樣兩種 shell 都能跑。
    $prevOrigin = [Environment]::GetEnvironmentVariable('UDEMY_EXTENSION_ORIGIN')
    try {
        [Environment]::SetEnvironmentVariable('UDEMY_EXTENSION_ORIGIN', $ExtensionOrigin)
        Start-Process -FilePath 'node' -ArgumentList @($dist) -WorkingDirectory $ServerDir
    }
    finally {
        [Environment]::SetEnvironmentVariable('UDEMY_EXTENSION_ORIGIN', $prevOrigin)
    }
    Add-Result -Chain $C -Status 'ok' -Name '已送出啟動' -Detail "node $dist（新視窗，UDEMY_EXTENSION_ORIGIN 已設定）"

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and -not (Test-Path $tokenPath)) { Start-Sleep -Milliseconds 500 }
    if (Test-Path $tokenPath) { Add-Result -Chain $C -Status 'ok' -Name 'pairing token 檔' -Detail $tokenPath }
    else { Add-Result -Chain $C -Status 'warn' -Name 'pairing token 檔' -Detail "30 秒內沒出現：$tokenPath" }

    if (Get-PortOwner -Port 8766) {
        Add-Result -Chain $C -Status 'ok' -Name '8766 listening' -Detail (Get-PortOwner -Port 8766)
    }
    else {
        Add-Result -Chain $C -Status 'fail' -Name '8766 listening' -Detail '沒有開始監聽；請看 server 視窗的 stderr'
    }
}

# ---------- 5. 下一步 ----------
if (-not $SkipInbox) {
    Add-NextStep "popup「GPT → Anki」貼上 token（檔案：$tokenPath），按「測試連線」應顯示『已連線本機 Inbox』。"
}
Add-NextStep '同步到 Anki 之前，Anki 要開著且已安裝 AnkiConnect（8765 才會有人聽）。'
Add-NextStep '停止服務：直接關掉各自的視窗，或在該視窗按 Ctrl+C。'

exit (Show-Summary -Title '啟動摘要')
