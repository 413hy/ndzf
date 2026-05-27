@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "PY_SCRIPT=%SCRIPT_DIR%convert_ayugram_session.py"

if "%~1"=="" (
  py "%PY_SCRIPT%"
) else (
  py "%PY_SCRIPT%" %*
)

echo.
pause
