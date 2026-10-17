@echo off
rem Code Tutor 悬浮窗启动器（支持多任务多开）
rem 用法：
rem   启动悬浮窗.cmd              → 默认任务 default，端口 19290
rem   启动悬浮窗.cmd iic          → 任务 iic，端口 19291
rem   启动悬浮窗.cmd iic 19292    → 任务 iic，端口 19292
rem 关键：清除 ELECTRON_RUN_AS_NODE，否则 electron.exe 会以纯 Node 模式运行，无法创建窗口
set ELECTRON_RUN_AS_NODE=
set TASKNAME=%~1
if "%TASKNAME%"=="" set TASKNAME=default
set TASKPORT=%~2
if "%TASKPORT%"=="" (
  if "%TASKNAME%"=="default" (set TASKPORT=19290) else (set TASKPORT=19291)
)
start "" "%~dp0electron.exe" "%~dp0." --task=%TASKNAME% --port=%TASKPORT%
