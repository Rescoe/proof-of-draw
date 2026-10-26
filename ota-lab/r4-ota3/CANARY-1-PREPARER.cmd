@echo off
rem Etape 1/3 du canari OTA-3 (mode porteur) : prevol + compilation de A et B + dossier de service. NE TOUCHE A AUCUNE CARTE (aucun televersement, aucun port ouvert).
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."
set "PATH=C:\Users\thibf\tools\winlibs-14.2\mingw64\bin;%PATH%"
node ota-lab\r4-ota3\canary\orchestrator.mjs --prepare %*
echo.
pause
