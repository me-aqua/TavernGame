@echo off
chcp 65001 >nul
title TavernGame - local dev server
setlocal

echo.
echo   ==================================================
echo      TavernGame - local server
echo   ==================================================
echo.
echo   TavernGame is a pure front-end game.
echo   You can just open the online version instead:
echo.
echo      https://me-aqua.github.io/TavernGame/
echo.
echo   This script starts a LOCAL server. Use it when you
echo   want to play offline or edit the code.
echo.
echo   Why local for development?
echo     - No browser/CDN cache: edit, refresh, done
echo     - Same files as the live site
echo.

set "ROOT=%~dp0"
pushd "%ROOT%"

if not exist "index.html" (
  echo   [ERROR] index.html not found in this folder:
  echo           %ROOT%
  echo   Please run this file from inside the project folder.
  echo.
  pause
  popd
  exit /b 1
)

if not exist "dev-server.js" (
  echo   [ERROR] dev-server.js not found.
  echo   Please keep the project files together.
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
  echo   The local server needs Node.js 18 or newer.
  echo   Download:  https://nodejs.org/
  echo.
  echo   Or skip this and just use the online version above.
  echo.
  pause
  popd
  exit /b 1
)

if "%PORT%"=="" set "PORT=3000"

for /f "delims=" %%v in ('node --version 2^>nul') do set "NODEVER=%%v"
echo   Node.js %NODEVER%  [OK]
echo   Starting local server on http://localhost:%PORT% ...
echo.

REM ---- Open the browser a moment later ----
start "" /b cmd /c "timeout /t 4 /nobreak >nul & start "" http://localhost:%PORT%/"

echo   --------------------------------------------------
echo    Game URL:  http://localhost:%PORT%/
echo.
echo    TO STOP:   close this window, or press Ctrl+C
echo   --------------------------------------------------
echo.

REM ---- Run the dev server in the foreground ----
node dev-server.js

echo.
echo   Server stopped.
popd
endlocal
pause
