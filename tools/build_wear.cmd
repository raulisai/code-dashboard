@echo off
setlocal
rem Isolated output avoids mapped ZIP locks on external Windows drives.
if defined WEAR_JAVA_HOME (
    set "JAVA_HOME=%WEAR_JAVA_HOME%"
) else if exist "%ProgramFiles%\Android\Android Studio\jbr\bin\java.exe" (
    set "JAVA_HOME=%ProgramFiles%\Android\Android Studio\jbr"
)
if not defined ANDROID_HOME set "ANDROID_HOME=%LOCALAPPDATA%\Android\Sdk"
if not defined WEAR_BUILD_DIR set "WEAR_BUILD_DIR=%TEMP%\codex-watch-mvp-build"
if not defined GRADLE_USER_HOME set "GRADLE_USER_HOME=%TEMP%\codex-watch-gradle"
if not defined WEAR_PROJECT_CACHE_DIR set "WEAR_PROJECT_CACHE_DIR=%GRADLE_USER_HOME%\watch-project"
if not defined GRADLE_RO_DEP_CACHE if exist "%USERPROFILE%\.gradle\caches\modules-2" set "GRADLE_RO_DEP_CACHE=%USERPROFILE%\.gradle\caches"
set "GRADLE_OPTS=%GRADLE_OPTS% -Dorg.gradle.native=false -Dorg.gradle.internal.instrumentation.agent=false"
set "WEAR_AAPT="
if exist "%ANDROID_HOME%\build-tools\36.0.0\aapt2.exe" set WEAR_AAPT="-Pandroid.aapt2FromMavenOverride=%ANDROID_HOME%\build-tools\36.0.0\aapt2.exe"
pushd "%~dp0..\wear" || exit /b 1
call gradlew.bat --console=plain --no-watch-fs --no-daemon --project-cache-dir "%WEAR_PROJECT_CACHE_DIR%" "-PwearBuildDirectory=%WEAR_BUILD_DIR%" %WEAR_AAPT% :app:assembleDebug :app:testDebugUnitTest :app:lintDebug :app:assembleDebugAndroidTest %*
set "WEAR_RESULT=%ERRORLEVEL%"
popd
if "%WEAR_RESULT%"=="0" echo APK: %WEAR_BUILD_DIR%\outputs\apk\debug\app-debug.apk
exit /b %WEAR_RESULT%
