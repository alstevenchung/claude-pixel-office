# Pixel Office launcher: starts the local server (hidden) if needed, then opens the page in its own
# app-style window (no tabs / address bar). Closing the window stops the server IF this script started it.
$ErrorActionPreference = 'SilentlyContinue'
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$url  = 'http://127.0.0.1:8787'
$prof = Join-Path $root '.app-profile'          # separate browser profile so this window is its own process

function Test-Up { try { (Invoke-WebRequest "$url/usage" -UseBasicParsing -TimeoutSec 1).StatusCode -eq 200 } catch { $false } }

$server = $null
if (-not (Test-Up)) {
  $server = Start-Process -FilePath 'node' -ArgumentList 'server\server.js' -WorkingDirectory $root -WindowStyle Hidden -PassThru
  for ($i = 0; $i -lt 40 -and -not (Test-Up); $i++) { Start-Sleep -Milliseconds 200 }
}

$candidates = @(
  "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
  "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
  "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe",
  "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)
$browser = $candidates | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $browser) { Start-Process $url; exit }  # no Edge/Chrome found: fall back to the default browser

$args = @("--app=$url", "--user-data-dir=`"$prof`"", '--window-size=1180,840', '--no-first-run', '--no-default-browser-check')
$p = Start-Process -FilePath $browser -ArgumentList $args -PassThru
$p.WaitForExit()
Start-Sleep -Seconds 2

# Only stop the server if we started it AND no other window of this app is still open
# (a second launch hands over to the first window and exits immediately).
if ($server) {
  $still = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*.app-profile*' }
  if (-not $still) { Stop-Process -Id $server.Id -Force }
}
