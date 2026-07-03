@echo off
setlocal

echo ===================================================
echo [RELEASE] Node-RED SLMP release check
echo ===================================================

echo [1/3] Updating canonical SLMP profile JSON...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\update_slmp_profile_jsons.ps1 -FailIfChanged
if %errorlevel% neq 0 (
    echo [ERROR] Canonical SLMP profile JSON check failed.
    exit /b %errorlevel%
)

echo [2/3] Checking registry version...
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\check_registry_duplicate.ps1 -Registry npm -Package "@fa_yoshinobu/node-red-contrib-plc-comm-slmp" -VersionSource package-json -ManifestPath package.json
if %errorlevel% neq 0 (
    echo [ERROR] Release version check failed.
    exit /b %errorlevel%
)

echo [3/3] Running CI...
call run_ci.bat
if %errorlevel% neq 0 (
    echo [ERROR] CI failed.
    exit /b %errorlevel%
)

echo ===================================================
echo [SUCCESS] Release check passed.
echo ===================================================
endlocal
