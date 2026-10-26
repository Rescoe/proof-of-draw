@echo off
rem RUN-CANARY.cmd — lanceur Windows du canari OTA-3 (A -> B -> A) sur UNO R4 WiFi. Double-clic. Une seule confirmation destructive (OTA3-A-B-A) avant le téléversement de A.
rem La fenêtre RESTE OUVERTE à la fin et affiche le verdict et le dossier runs\<horodatage>.
setlocal
chcp 65001 >nul
cd /d "%~dp0\..\.."
set "PATH=C:\Users\thibf\tools\winlibs-14.2\mingw64\bin;%PATH%"
echo.
echo ====================================================================
echo  CANARI OTA-3 : A -^> B -^> A   (UNO R4 WiFi)
echo  Branchez UNE seule carte, fermez le moniteur série de l'IDE Arduino.
echo  RIEN ne sera téléversé avant que vous tapiez la confirmation.
echo ====================================================================
echo.
node ota-lab\r4-ota3\canary\orchestrator.mjs %*
set "CODE=%ERRORLEVEL%"
echo.
echo Code de sortie : %CODE%   (0 = PASS, 1 = échec/arrêt)
echo Les résultats sont dans ota-lab\r4-ota3\runs\ (dossier le plus récent).
echo.
pause
exit /b %CODE%
