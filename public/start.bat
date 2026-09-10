@echo off
chcp 65001 >nul
title TavernGame
setlocal

echo.
echo   =============================================
echo      TavernGame - one-click launcher
echo   =============================================
echo.

REM ---- Locate project root (this file sits in public\) ----
set "ROOT=%~dp0.."
pushd "%ROOT%"

if not exist "server\index.js" (
  echo   [ERROR] server\index.js not found.
  echo   Please keep the folder structure intact.
  echo.
  pause
  popd
  exit /b 1
)

REM ---- Check Node.js ----
where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found.
  echo.
  echo   TavernGame needs Node.js 18 or newer.
  echo   Download:  https://nodejs.org/
  echo.
  echo   After installing, run this file again.
  echo.
  pause
  popd
  exit /b 1
)

for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
echo   Node.js %NODEVER%  [OK]
echo   Starting server...
echo.

REM ---- Open the browser a moment from now ----
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start "" http://localhost:3000/play.html"

echo   --------------------------------------------------
echo    Browser will open at:  localhost:3000/play.html
echo.
echo    TO STOP:  close this window, or press Ctrl+C
echo   --------------------------------------------------
echo.

REM ---- Run the server in the foreground ----
REM Foreground makes this script the server window itself,
REM which is simpler and avoids nested-quote headaches.
node server\index.js

echo.
echo   Server stopped.
popd
endlocal
pause
