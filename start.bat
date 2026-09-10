@echo off
chcp 65001 >nul
title TavernGame - local server
setlocal

echo.
echo   ==================================================
echo      TavernGame - local test server
echo   ==================================================
echo.
echo   NOTE: TavernGame is a pure front-end game.
echo   You can usually just open the online version:
echo.
echo      https://me-aqua.github.io/TavernGame/play.html
echo.
echo   This script starts a small local web server so you
echo   can play offline, or develop without deploying.
echo.

REM ---- This file can sit anywhere in the project; use its own folder ----
set "ROOT=%~dp0"
pushd "%ROOT%"

if not exist "play.html" (
  echo   [ERROR] play.html not found in this folder:
  echo           %ROOT%
  echo   Please run this file from inside the project folder.
  echo.
  pause
  popd
  exit /b 1
)

REM ---- Node.js is required by npx ----
where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found.
  echo.
  echo   This local server needs Node.js 18 or newer.
  echo   Download:  https://nodejs.org/
  echo.
  echo   Or skip this entirely and use the online version above.
  echo.
  pause
  popd
  exit /b 1
)

for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
echo   Node.js %NODEVER%  [OK]
echo.
echo   Starting local server on http://localhost:3000 ...
echo   (First run downloads a tiny static server, may take a moment)
echo.

REM ---- Open the browser a few seconds later ----
start "" /b cmd /c "timeout /t 8 /nobreak >nul & start "" http://localhost:3000/play.html"

echo   --------------------------------------------------
echo    Game URL:  http://localhost:3000/play.html
echo.
echo    TO STOP:  close this window, or press Ctrl+C
echo   --------------------------------------------------
echo.

REM ---- Run the static server in the foreground ----
npx --yes serve -l 3000 .

echo.
echo   Server stopped.
popd
endlocal
pause
