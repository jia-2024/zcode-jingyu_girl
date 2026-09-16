@echo off
rem 鲸鱼娘桌宠：启动本地服务 + ZCode 内桌宠（控制台可从桌宠右键菜单打开）
cd /d "%~dp0"
start "zcode-balance-whale" /min "H:\node\node.exe" server.mjs
timeout /t 1 /nobreak >nul
start "whale-pet" /min python pet.py
