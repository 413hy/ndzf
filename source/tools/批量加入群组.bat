@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "PY_SCRIPT=%SCRIPT_DIR%join_group_sessions.py"

set /p SESSION_DIR=请输入转换后的 session 目录路径：
set /p INVITE_LINK=请输入群邀请链接：

py "%PY_SCRIPT%" "%SESSION_DIR%" "%INVITE_LINK%"

echo.
pause
