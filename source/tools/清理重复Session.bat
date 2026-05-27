@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
py "%SCRIPT_DIR%cleanup_duplicate_sessions.py"

echo.
pause
