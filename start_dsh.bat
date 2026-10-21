@echo off
setlocal
node "%~dp0start_dsh.mjs" %*
set CODE=%ERRORLEVEL%
if not "%CODE%"=="0" (
  echo.
  echo [exit code %CODE%] see errors above, press any key to close.
  pause >nul
)
exit /b %CODE%
