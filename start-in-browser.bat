@echo off
rem Old behaviour: start the server minimised and open the page in your normal browser.
cd /d "%~dp0"
powershell -NoProfile -Command "try{Invoke-WebRequest http://127.0.0.1:8787/usage -UseBasicParsing -TimeoutSec 1 | Out-Null; exit 0}catch{exit 1}"
if errorlevel 1 (
  start "PixelOffice server" /min node server\server.js
  timeout /t 2 /nobreak >nul
)
start "" http://127.0.0.1:8787
