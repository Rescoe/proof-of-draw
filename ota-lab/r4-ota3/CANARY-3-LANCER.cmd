@echo off
rem Etape 3/3 : canari A -> B -> A en mode porteur. La carte doit DEJA porter l'image A de la preparation (televersee par vos soins) et le serveur (etape 2) tourner. Une seule confirmation : OTA3-A-B-A.
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."
set "PATH=C:\Users\thibf\tools\winlibs-14.2\mingw64\bin;%PATH%"
node ota-lab\r4-ota3\canary\orchestrator.mjs --attach %*
set "CODE=%ERRORLEVEL%"
echo.
echo Code de sortie : %CODE%   (0 = PASS, 1 = echec ou arret)
echo Resultats : ota-lab\r4-ota3\runs\ (dossier le plus recent) - verdict.txt
echo.
pause
exit /b %CODE%
