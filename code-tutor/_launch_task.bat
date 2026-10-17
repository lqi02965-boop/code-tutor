@echo off
set ELECTRON_RUN_AS_NODE=
start "" "%~dp0electron.exe" "%~dp0." --task=%1 --port=%2
