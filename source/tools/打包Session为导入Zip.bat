@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "PY_SCRIPT=%SCRIPT_DIR%pack_sessions_zip.py"

if "%~1"=="" (
  py "%PY_SCRIPT%"
) else (
  py "%PY_SCRIPT%" "%~1"
)

echo.
pause
