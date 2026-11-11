# 像素辦公室 安裝 / 移除程式（雙擊 install.bat 或 uninstall.bat 即可，不必直接執行這個檔案）
# 這個檔案以 UTF-8 (含 BOM) 儲存，Windows PowerShell 5.1 才能正確顯示中文。
param(
  [string]$SettingsPath = (Join-Path $env:USERPROFILE '.claude\settings.json'),
  [string]$DesktopPath = [Environment]::GetFolderPath('Desktop'),
  [switch]$Yes,        # 略過確認（只給自動測試用）
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$sendJs  = Join-Path $root 'hook\send.js'
$helper  = Join-Path $root 'tools\settings-hooks.js'
$lnkPath = Join-Path $DesktopPath '像素辦公室.lnk'
$startBat = Join-Path $root 'start.bat'

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }
function Step($n, $total, $t) { Write-Host ''; Write-Host ('[{0}/{1}] {2}' -f $n, $total, $t) -ForegroundColor Cyan }
function Ok($t)   { Write-Host "      完成：$t" -ForegroundColor Green }
function Info($t) { Write-Host "      $t" -ForegroundColor Gray }
function Warn($t) { Write-Host "      注意：$t" -ForegroundColor Yellow }
function Stop-Here($t) { Write-Host "      失敗：$t" -ForegroundColor Red; Write-Host ''; Say '已停止。沒有做任何變更（或已還原）。' 'Yellow'; exit 1 }
function Ask($q) { if ($Yes) { return $true }; $a = Read-Host $q; return ($a -match '^[Yy]') }
function Run-Helper($mode) {
  $out = (& node $helper $mode $SettingsPath $sendJs | Out-String).Trim()
  try { return ($out | ConvertFrom-Json) } catch { Stop-Here "設定工具回傳了無法理解的結果：$out" }
}

Write-Host ''
Say '==================================================' 'White'
if ($Uninstall) { Say '  像素辦公室  移除程式' 'White' } else { Say '  像素辦公室  安裝程式' 'White' }
Say '==================================================' 'White'
Write-Host ''

if (-not $Uninstall) {
  Say '這個安裝程式會做以下 4 件事：'
  Write-Host ''
  Say '  1. 檢查電腦有沒有 Node.js'
  Say '       （沒有的話會告訴你去哪裡下載，不會自動安裝任何東西）'
  Say '  2. 備份你的 Claude 設定檔：'
  Say "       $SettingsPath"
  Say '  3. 在這個設定檔加入 9 個「hooks」（事件掛鉤），讓小人知道 Claude 在做什麼'
  Say '       （SessionStart、UserPromptSubmit、PreToolUse、PostToolUse、Notification、'
  Say '        Stop、SessionEnd、SubagentStart、SubagentStop）'
  Say "       它們指向：$sendJs"
  Say '       你原本的設定與 hooks 不會被修改或刪除；重複安裝也不會重複加入'
  Say '  4. 在桌面建立「像素辦公室」捷徑'
  Write-Host ''
  Say '它「不會」做的事：' 'Yellow'
  Say '  - 不會連上網際網路、不會安裝其他軟體、不會修改系統設定'
  Say '  - 伺服器只在這台電腦內運作（127.0.0.1），其他電腦連不到'
  Write-Host ''
  Say '會被讀取或使用的資料（全部只在這台電腦內傳遞，不會離開電腦）：' 'Yellow'
  Say '  - Claude 當下的狀態、專案資料夾名稱、正在編輯的檔名、使用的模型'
  Say '  - 指令只會被「分類」（例如：推送、資料庫、連線伺服器），不會記錄指令內容、'
  Say '    密碼、程式碼或你的提問；連線伺服器或資料庫時，畫面會顯示「主機名稱」'
  Say '    （不含帳號與密碼）'
  Say '  - 用量數字讀自 Claude 存在本機的對話紀錄，只取 token 數量與模型名稱，不保存對話內容'
  Write-Host ''
  Say '之後想還原，雙擊同一個資料夾裡的 uninstall.bat。' 'Green'
  Write-Host ''
  if (-not (Ask '要繼續安裝嗎？(輸入 Y 繼續，其他鍵取消)')) { Write-Host ''; Say '已取消，沒有做任何變更。' 'Yellow'; exit 0 }

  # ---- 1. Node.js
  Step 1 4 '檢查 Node.js'
  $node = Get-Command node -ErrorAction SilentlyContinue
  if (-not $node) {
    Write-Host '      找不到 Node.js。' -ForegroundColor Red
    Say '      請先到 https://nodejs.org 下載並安裝「LTS」版本，安裝完成後再雙擊 install.bat 一次。' 'Yellow'
    Write-Host ''; Say '已停止。沒有做任何變更。' 'Yellow'; exit 1
  }
  Ok ('已安裝 Node.js ' + (& node --version))

  # ---- 2 + 3. backup + hooks
  Step 2 4 '備份並更新 Claude 設定檔'
  if (-not (Test-Path (Split-Path $SettingsPath -Parent))) { Warn '找不到 Claude 設定資料夾（可能還沒用過 Claude Code）。會建立一個新的設定檔。' }
  $r = Run-Helper 'install'
  if (-not $r.ok) { Stop-Here $r.error }
  if ($r.changed) {
    if ($r.backup) { Ok "已備份原設定檔 → $($r.backup)" } else { Info '原本沒有設定檔，已建立新的。' }
    Step 3 4 '加入 hooks'
    if ($r.added.Count -gt 0) { Ok ("新增了 $($r.added.Count) 個 hooks：" + ($r.added -join '、')) }
    if ($r.replaced -gt 0)    { Ok "更新了 $($r.replaced) 個指向舊位置的 hooks" }
  } else {
    Info '設定檔不需要變更（hooks 之前就已經安裝好了），沒有產生備份。'
    Step 3 4 '加入 hooks'
    Ok '9 個 hooks 都已存在，沒有重複加入'
  }
  if ($r.otherInstalls -gt 0) { Warn "偵測到另一份「像素辦公室」也裝在別的位置，兩份會同時收到事件。若不需要，請到那份資料夾執行 uninstall.bat。" }

  # ---- 4. shortcut
  Step 4 4 '建立桌面捷徑'
  if (-not (Test-Path $DesktopPath)) { Warn "找不到桌面資料夾（$DesktopPath），略過捷徑。你仍可雙擊 start.bat 開啟。" }
  else {
    $ws = New-Object -ComObject WScript.Shell
    $lnk = $ws.CreateShortcut($lnkPath)
    $lnk.TargetPath = $startBat
    $lnk.WorkingDirectory = $root
    $ico = Join-Path $root 'app.ico'
    if (Test-Path $ico) { $lnk.IconLocation = "$ico,0" }
    $lnk.WindowStyle = 7
    $lnk.Description = '像素辦公室 - 把 Claude Code 的工作狀態畫成像素辦公室'
    $lnk.Save()
    Ok "已建立：$lnkPath"
  }

  Write-Host ''
  Say '==================================================' 'Green'
  Say '  安裝完成！' 'Green'
  Say '==================================================' 'Green'
  Say '  使用方式：雙擊桌面的「像素辦公室」。'
  Say '  重要：已經開著的 Claude Code 視窗不會載入新設定，請關掉後重新開啟。'
  Say '  移除：雙擊這個資料夾裡的 uninstall.bat。'
  Write-Host ''
  if (-not $Yes) { if (Ask '現在要開啟像素辦公室嗎？(Y/N)') { Start-Process -FilePath $startBat } }
  exit 0
}

# ================= Uninstall =================
Say '這個移除程式會做以下 3 件事：'
Write-Host ''
Say '  1. 備份你的 Claude 設定檔：'
Say "       $SettingsPath"
Say '  2. 從設定檔移除「指向這個資料夾」的 9 個 hooks'
Say '       你自己的其他設定與 hooks 不會被動到'
Say '  3. 刪除桌面的「像素辦公室」捷徑（只刪指向這個資料夾的那一個）'
Write-Host ''
Say '不會刪除這個程式資料夾本身。如果像素辦公室正開著，請先關掉它的視窗。' 'Yellow'
Write-Host ''
if (-not (Ask '要繼續移除嗎？(輸入 Y 繼續，其他鍵取消)')) { Write-Host ''; Say '已取消，沒有做任何變更。' 'Yellow'; exit 0 }

Step 1 3 '檢查 Node.js（用來安全地編輯設定檔）'
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Stop-Here '找不到 Node.js，無法安全地編輯設定檔。' }
Ok ('Node.js ' + (& node --version))

Step 2 3 '備份並移除 hooks'
if (-not (Test-Path $SettingsPath)) { Info '找不到 Claude 設定檔，沒有需要移除的 hooks。' }
else {
  $r = Run-Helper 'uninstall'
  if (-not $r.ok) { Stop-Here $r.error }
  if ($r.changed) { Ok "已備份原設定檔 → $($r.backup)"; Ok "已移除 $($r.removed) 個 hooks" }
  else { Info '設定檔裡沒有指向這個資料夾的 hooks，不需要變更。' }
}

Step 3 3 '刪除桌面捷徑'
$removedLnk = $false
if (Test-Path $lnkPath) {
  $target = (New-Object -ComObject WScript.Shell).CreateShortcut($lnkPath).TargetPath
  if ($target -ieq $startBat) { Remove-Item $lnkPath -Force; $removedLnk = $true; Ok "已刪除：$lnkPath" }
  else { Warn '桌面上的「像素辦公室」捷徑指向別的位置，所以沒有刪除。' }
}
if (-not $removedLnk -and -not (Test-Path $lnkPath)) { Info '桌面上沒有這個捷徑。' }

Write-Host ''
Say '==================================================' 'Green'
Say '  移除完成。' 'Green'
Say '==================================================' 'Green'
Say '  已經開著的 Claude Code 視窗要重新開啟，才會停止回報狀態。'
Say '  若要完全刪除，直接刪掉這個資料夾即可。'
Write-Host ''
exit 0
