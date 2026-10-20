@echo off
setlocal
set "WEAR_SERIAL=%~1"
if not "%WEAR_SERIAL:~0,9%"=="emulator-" (
    echo Usage: verify_wear_android.cmd emulator-SERIAL [build-directory]
    echo This test clears the emulator app's local session. It never targets a physical watch.
    exit /b 2
)
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
set "WEAR_OUTPUT=%~2"
if not defined WEAR_OUTPUT set "WEAR_OUTPUT=%TEMP%\codex-watch-mvp-build"
set "WEAR_ADB=%ANDROID_HOME%\platform-tools\adb.exe"
"%WEAR_ADB%" -s "%WEAR_SERIAL%" install -r "%WEAR_OUTPUT%\outputs\apk\debug\app-debug.apk" || exit /b 1
"%WEAR_ADB%" -s "%WEAR_SERIAL%" install -r "%WEAR_OUTPUT%\outputs\apk\androidTest\debug\app-debug-androidTest.apk" || exit /b 1
set "WEAR_TEST_LOG=%TEMP%\codex-watch-tests-%WEAR_SERIAL%.log"
"%WEAR_ADB%" -s "%WEAR_SERIAL%" shell am instrument -w lat.devdj.codex.watch.test/androidx.test.runner.AndroidJUnitRunner > "%WEAR_TEST_LOG%" 2>&1
set "WEAR_TEST_RESULT=%ERRORLEVEL%"
type "%WEAR_TEST_LOG%"
if not "%WEAR_TEST_RESULT%"=="0" exit /b %WEAR_TEST_RESULT%
findstr /b /c:"OK (" "%WEAR_TEST_LOG%" >nul
exit /b %ERRORLEVEL%
