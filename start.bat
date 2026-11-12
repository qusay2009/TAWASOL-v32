@echo off
title TAWASOL - تواصل
cd /d "%~dp0"
echo ====================================================
echo            TAWASOL Platform Server
echo            Connected to Supabase Cloud DB
echo ====================================================
echo.
echo Starting web server on http://localhost:8000 ...
start "" http://localhost:8000

where node >nul 2>&1
if %errorlevel% equ 0 (
    node server/server.mjs
) else (
    set ELECTRON_RUN_AS_NODE=1
    "C:\Users\user\AppData\Local\Programs\Microsoft VS Code\Code.exe" server\server.mjs
)
pause
