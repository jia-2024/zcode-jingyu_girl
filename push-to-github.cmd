@echo off
rem 鲸鱼娘桌宠：一键推送到 GitHub（首次会弹出浏览器授权，登录你的账号即可）
cd /d "%~dp0"
if "%~1"=="" (
  set /p REPO_URL=粘贴你的 GitHub 仓库地址（如 https://github.com/你的用户名/whale-chan-pet.git）:
) else set REPO_URL=%~1
git remote remove origin 2>nul
git remote add origin "%REPO_URL%"
git push -u origin main
echo.
echo 完成！仓库地址：%REPO_URL%
pause
