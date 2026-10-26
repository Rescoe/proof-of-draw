@echo off
rem Etape 2/3 : serveur local du canari (sert good.ota et to-a.ota de la DERNIERE preparation). Laisser cette fenetre OUVERTE ; Ctrl+C pour arreter.
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."
node ota-lab\r4-ota3\canary\serve-latest.mjs %*
echo.
pause
