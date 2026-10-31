@echo off
rem Installs Smart Captions for Premiere Pro on Windows (unsigned extension, debug mode).
set "SRC=%~dp0"
set "DEST=%APPDATA%\Adobe\CEP\extensions\smart-captions"
for %%v in (9 10 11 12 13) do reg add "HKCU\Software\Adobe\CSXS.%%v" /v PlayerDebugMode /t REG_SZ /d 1 /f >nul
if exist "%DEST%" rmdir /s /q "%DEST%"
mkdir "%DEST%"
xcopy "%SRC%CSXS" "%DEST%\CSXS\" /e /i /q >nul
xcopy "%SRC%css" "%DEST%\css\" /e /i /q >nul
xcopy "%SRC%js" "%DEST%\js\" /e /i /q >nul
xcopy "%SRC%jsx" "%DEST%\jsx\" /e /i /q >nul
copy "%SRC%index.html" "%DEST%\" >nul
copy "%SRC%.debug" "%DEST%\" >nul
copy "%SRC%version.json" "%DEST%\" >nul
copy "%SRC%update-config.json" "%DEST%\" >nul
echo Installed to: %DEST%
echo Restart Premiere Pro, then open Window ^> Extensions ^> Smart Captions.
pause
