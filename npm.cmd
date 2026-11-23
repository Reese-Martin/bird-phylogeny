@echo off
setlocal
set "EVERYBIRD_NODE=node"
where node >nul 2>nul
if errorlevel 1 set "EVERYBIRD_NODE=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"
pushd "%~dp0"
if not exist ".tools\npm\package\bin\npm-cli.js" (
  "%EVERYBIRD_NODE%" scripts\bootstrap-npm.mjs
  if errorlevel 1 (popd & exit /b 1)
)
"%EVERYBIRD_NODE%" .tools\npm\package\bin\npm-cli.js %*
set "EVERYBIRD_EXIT=%ERRORLEVEL%"
popd
exit /b %EVERYBIRD_EXIT%
