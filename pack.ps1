# 像素辦公室 打包程式：產生要給別人的 PixelOffice.zip（雙擊 pack.bat 即可）
# 這個檔案以 UTF-8 (含 BOM) 儲存，Windows PowerShell 5.1 才能正確顯示中文。
param([string]$OutputDir = [Environment]::GetFolderPath('Desktop'))
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$root    = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $OutputDir 'PixelOffice.zip'

# 「白名單」：只打包明確列出的項目。之後新增的個人檔案不會不小心被帶進去。
$include = @('app.ico', 'app.ps1', 'install.bat', 'install.ps1', 'uninstall.bat', 'start.bat', 'start-in-browser.bat',
             'package.json', 'usage-config.json', 'hook', 'server', 'web', 'tools', 'tests', '.claude\skills')
# 會掃描這些字樣，發現就停止打包（避免把個人資訊給出去）。
# 字樣取自「執行這個程式的電腦」：使用者名稱、使用者資料夾、這個專案所在的位置 —— 程式碼裡不寫死任何人的資訊。
# 想多擋一些（例如信箱、公司或專案名稱），每行寫一個字樣在 .pack-extra-patterns.txt（這個檔案不會被打包、也不會上傳）。
$parts = @($env:USERNAME, $env:USERPROFILE, $root, ($root -replace "\\", "/"))
$extraFile = Join-Path $root '.pack-extra-patterns.txt'
if (Test-Path $extraFile) { $parts += @(Get-Content $extraFile -Encoding UTF8 | Where-Object { $_.Trim() }) }
$personal = ($parts | Where-Object { $_ } | ForEach-Object { '(?<![A-Za-z0-9])' + [regex]::Escape($_.Trim()) + '(?![A-Za-z0-9])' }) -join '|'

function Say($t, $c = 'Gray') { Write-Host $t -ForegroundColor $c }

Write-Host ''
Say '==================================================' 'White'
Say '  像素辦公室  打包程式' 'White'
Say '==================================================' 'White'
Write-Host ''
Say '這個程式會把要給別人的檔案打包成一個 zip：'
Say "  → $zipPath" 'White'
Write-Host ''
Say '會放進去的：程式本身、安裝／移除程式、桌面圖示、測試與說明。' 'Gray'
Say '「不會」放進去的（你的個人資料）：' 'Yellow'
Say '  - .app-profile       你的應用程式視窗所用的瀏覽器資料（約 80 MB）'
Say '  - office-state.json  你目前的專案名稱與 Claude 正在做的事'
Say '  - 其他沒有列在白名單裡的任何檔案（例如之後不小心放進資料夾的東西）'
Say '它只會「讀」這個資料夾、並在上面的位置寫出 zip，不會修改任何設定。'
Write-Host ''

$stage = Join-Path $env:TEMP ('PixelOffice-pack-' + [guid]::NewGuid().ToString('N'))
$pkg   = Join-Path $stage 'PixelOffice'
try {
  New-Item -ItemType Directory -Force $pkg | Out-Null
  Say '[1/4] 複製檔案到暫存資料夾' 'Cyan'
  foreach ($item in $include) {
    $src = Join-Path $root $item
    if (-not (Test-Path $src)) { throw "找不到必要的項目：$item" }
    $dst = Join-Path $pkg $item
    New-Item -ItemType Directory -Force (Split-Path $dst -Parent) | Out-Null
    Copy-Item $src $dst -Recurse -Force
  }
  $files = @(Get-ChildItem $pkg -Recurse -File)
  Say "      完成：$($files.Count) 個檔案" 'Green'

  Say '[2/4] 檢查有沒有個人資訊' 'Cyan'
  $textExt = '.js', '.ps1', '.bat', '.json', '.md', '.html'
  $hits = @($files | Where-Object { $textExt -contains $_.Extension } | Select-String -Pattern $personal -List)
  if ($hits.Count -gt 0) {
    Say '      失敗：下列檔案含有個人資訊，已停止打包（沒有產生 zip）：' 'Red'
    $hits | ForEach-Object { Say ('        ' + $_.Path.Substring($pkg.Length + 1) + '  →  ' + $_.Line.Trim()) 'Red' }
    exit 1
  }
  Say '      完成：沒有發現個人資訊' 'Green'

  Say '[3/4] 檢查必要檔案' 'Cyan'
  foreach ($must in 'install.bat', 'install.ps1', 'start.bat', 'hook\send.js', 'server\server.js', 'web\index.html', 'tools\settings-hooks.js') {
    if (-not (Test-Path (Join-Path $pkg $must))) { throw "打包內容缺少：$must" }
  }
  $bom = [System.IO.File]::ReadAllBytes((Join-Path $pkg 'install.ps1'))[0..2]
  if (-not ($bom[0] -eq 0xEF -and $bom[1] -eq 0xBB -and $bom[2] -eq 0xBF)) { throw 'install.ps1 缺少 UTF-8 BOM，對方的畫面會出現亂碼' }
  Say '      完成' 'Green'

  Say '[4/4] 產生 zip' 'Cyan'
  New-Item -ItemType Directory -Force $OutputDir | Out-Null
  if (Test-Path $zipPath) { Remove-Item $zipPath -Force; Say '      （已存在同名檔案，已覆蓋）' 'Yellow' }
  Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
  $zipStream = [System.IO.File]::Open($zipPath, 'Create')
  $archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)
  try {
    Get-ChildItem $stage -Recurse -File -Force | ForEach-Object {
      $entryName = $_.FullName.Substring($stage.Length + 1).Replace('\', '/')   # standard '/' separators: works on every OS
      [void][System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $_.FullName, $entryName, [System.IO.Compression.CompressionLevel]::Optimal)
    }
  } finally { $archive.Dispose(); $zipStream.Dispose() }
  $kb = [math]::Round((Get-Item $zipPath).Length / 1KB)
  Say "      完成：$zipPath  ($kb KB)" 'Green'
}
finally { if (Test-Path $stage) { Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue } }

Write-Host ''
Say '==================================================' 'Green'
Say '  打包完成！' 'Green'
Say '==================================================' 'Green'
Say '  把 PixelOffice.zip 給對方，並告訴他：'
Say '    1. 解壓縮（放在哪裡都可以）'
Say '    2. 雙擊裡面的 install.bat，看完說明後輸入 Y'
Say '  對方需要：Windows、Node.js、Edge 或 Chrome、較新版的 Claude Code。'
Write-Host ''
