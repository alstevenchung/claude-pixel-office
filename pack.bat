@echo off
rem Pixel Office packer - builds PixelOffice.zip (on the Desktop) to hand to someone else.
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack.ps1"
echo.
pause
