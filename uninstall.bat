@echo off
rem Pixel Office uninstaller - explains what it will do, then asks before changing anything.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0install.ps1" -Uninstall
echo.
pause
