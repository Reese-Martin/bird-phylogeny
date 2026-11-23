@echo off
setlocal
pushd "%~dp0"
if not exist "node_modules\vite\bin\vite.js" (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 (pause & popd & exit /b 1)
)
echo Open http://127.0.0.1:5173 in your browser.
echo Keep this window open. Press Ctrl+C here to stop phyloBirds.
call npm.cmd run start
if errorlevel 1 pause
popd
