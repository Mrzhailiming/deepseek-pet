@echo off
rem 双击就能用：装插件 + 起 dsh。参数原样转给 start_dsh.mjs，例如
rem   start_dsh.bat --no-start
rem   start_dsh.bat --repo D:\dsh -- --dump-config
setlocal
node "%~dp0start_dsh.mjs" %*
set CODE=%ERRORLEVEL%
if not "%CODE%"=="0" (
  echo.
  echo [退出码 %CODE%] 上面有报错，看完按任意键关窗口。
  pause >nul
)
exit /b %CODE%
