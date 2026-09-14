@echo off
chcp 65001 >nul
title TavernGame - local dev server
setlocal

echo.
echo   ==================================================
echo      TavernGame - local dev server
echo   ==================================================
echo.
echo   TavernGame is a pure front-end game.
echo   You can just open the online version instead:
echo.
echo      https://me-aqua.github.io/TavernGame/
echo.
echo   This script starts the DEV SERVER. Use it when you
echo   want to play offline or edit the code.
echo.
echo   Why dev (not just open index.html)?
echo     - Source is Vue + TypeScript, browsers can't run it directly
echo     - Hot reload: save a file, the browser updates itself
echo.
echo   NOTE: the game is served under the /TavernGame/ path,
echo         so the URL is http://localhost:3000/TavernGame/
echo.

set "ROOT=%~dp0"
pushd "%ROOT%"

if not exist "package.json" (
  echo   [ERROR] package.json not found in this folder:
  echo           %ROOT%
  echo   Please run this file from inside the project folder.
  echo.
  pause
  popd
  exit /b 1
)

REM ---- Node.js is required ----
where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found.
  echo.
  echo   This project needs Node.js 20 or newer to build.
  echo   Download:  https://nodejs.org/
  echo.
  echo   Or skip this and just use the online version above.
  echo.
  pause
  popd
  exit /b 1
)

for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
echo   Node.js %NODEVER%  [OK]

REM ---- Install dependencies on first run ----
if not exist "node_modules" (
  echo.
  echo   First run: installing dependencies ^(needs network^)...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo   [ERROR] npm install failed. Check your network or proxy.
    echo.
    pause
    popd
    exit /b 1
  )
)

if "%PORT%"=="" set "PORT=3000"

echo.
echo   Starting dev server ...
echo.
echo   --------------------------------------------------
echo    Game URL:  http://localhost:%PORT%/TavernGame/
echo.
echo    TO STOP:   close this window, or press Ctrl+C
echo   --------------------------------------------------
echo.

REM ---- Open the browser a moment later ----
start "" /b cmd /c "timeout /t 5 /nobreak >nul & start "" http://localhost:%PORT%/TavernGame/"

REM ---- Run Vite in the foreground ----
call npm run dev

echo.
echo   Server stopped.
popd
endlocal
pause
