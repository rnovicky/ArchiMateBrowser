@echo off
setlocal

rem ------------------------------------------------------------
rem  archimatebrowser.bat - install, start and test the ArchiMate Browser
rem
rem  Usage:
rem    archimatebrowser.bat install [options]  check Python, set up the API key, check the API, run
rem    archimatebrowser.bat deploy C:\Apps\ArchiMateBrowser [start]
rem                                               from an unzipped package: install into that folder,
rem                                               or update the installation there (deploy.ps1)
rem    archimatebrowser.bat start [options]    start the browser on http://127.0.0.1:8090/
rem    archimatebrowser.bat run [options]      start it and open the page in the default web browser
rem    archimatebrowser.bat test [options]     run the tests (not part of an install package)
rem
rem  Options are passed on to server\serve.py (start, run, install) or to
rem  tests\run_tests.py (test), e.g.  start --port 9000,  run --api http://host:8000,
rem  test --filter smoke.
rem
rem  The browser proxies /api/* to the ArchiMate API (default
rem  http://127.0.0.1:8000, or ARCHIXMI_API, or --api). The API key the proxy
rem  adds to every request is taken from the first of:
rem    1. .env in this folder:   ARCHIXMI_API_KEY=<key>
rem       Recommended: a key with the role "reader" (see "API keys and roles"
rem       in the API's README). Import XMI and Delete model are then hidden.
rem    2. .env of the API folder next to this one (..\ArchiMateAPI, or its
rem       earlier names): its API_KEY, the admin key. The file is only read.
rem
rem  The script may sit in the project folder or next to it (in the folder
rem  that holds ArchiMateBrowser\).
rem ------------------------------------------------------------

set "SELF=%~nx0"
set "ACTION=%~1"
rem deploy's folder, made absolute before the cd below
set "TARGET=%~f2"
set "DEPLOY_START="
if /i "%~3"=="start" set "DEPLOY_START=-Start"

rem Find the project folder: this folder, or ArchiMateBrowser\ next to the script
set "ROOT=%~dp0"
if not exist "%ROOT%index.html" if exist "%~dp0ArchiMateBrowser\index.html" set "ROOT=%~dp0ArchiMateBrowser\"
if not exist "%ROOT%server\serve.py" (
    echo ERROR: Could not find the ArchiMateBrowser folder or server\serve.py.
    exit /b 1
)
cd /d "%ROOT%"

rem The options after the command, passed on as they are
set "ARGS="
shift
:collect
if "%~1"=="" goto :collected
set ARGS=%ARGS% %1
shift
goto :collect
:collected

if "%ACTION%"=="" goto :usage
if /i "%ACTION%"=="help" goto :usage
if /i "%ACTION%"=="install" goto :do_install
if /i "%ACTION%"=="deploy" goto :do_deploy
if /i "%ACTION%"=="start" goto :do_start
if /i "%ACTION%"=="run" goto :do_run
if /i "%ACTION%"=="test" goto :do_test
echo ERROR: Unknown command: %ACTION%
echo.
goto :usage

rem ============================================================
:do_install
echo [1/3] Checking Python...
python -c "import sys; sys.exit(sys.version_info < (3, 9))" 2>nul
if errorlevel 1 (
    echo ERROR: Python 3.9 or later is needed on the PATH. Nothing else has to be installed.
    goto :install_failed
)

call :env_file
if exist ".env" (
    echo [2/3] .env already exists, leaving it untouched.
    goto :install_check_api
)
if defined ENVFILE (
    echo [2/3] Using API_KEY of %ENVFILE%, the API's admin key.
    echo       For a key with the role "reader", copy .env.example to .env and set ARCHIXMI_API_KEY.
    goto :install_check_api
)
echo [2/3] Creating .env from .env.example...
copy .env.example .env >nul
if errorlevel 1 goto :install_failed
echo.
echo  Set ARCHIXMI_API_KEY in .env to a key of the API, preferably one
echo  with the role "reader".
echo  Opening .env in Notepad - save and close it to continue.
echo.
notepad .env

:install_check_api
echo [3/3] Checking the API...
set "API_URL=%ARCHIXMI_API%"
if not defined API_URL set "API_URL=http://127.0.0.1:8000"
set "HEALTH="
for /f %%C in ('curl -s -o nul -w "%%{http_code}" "%API_URL%/health" 2^>nul') do set "HEALTH=%%C"
if "%HEALTH%"=="200" (
    echo       The API answers at %API_URL%.
) else (
    echo       WARNING: no API answers at %API_URL%. Start it first, e.g. with
    echo       "archimateapi.bat start" in the API folder, or pass --api ^<root URL^>.
)

echo.
echo Installation complete. Starting the browser...
echo.
goto :do_run

:install_failed
echo.
echo Installation failed. See the messages above.
pause
exit /b 1

rem ============================================================
:do_start
call :env_file
if exist ".env" set "ENVFILE=.env"
set "ENVARG="
if defined ENVFILE set ENVARG=--env-file "%ENVFILE%"
python server\serve.py %ENVARG% %ARGS%
exit /b %errorlevel%

rem ============================================================
:do_run
set ARGS=--open %ARGS%
goto :do_start

rem ============================================================
:do_test
rem The tests start the real API on a temporary database, so they need the
rem API folder next to this one and its Python packages. The API's own
rem database is not touched. Exit code 0 = all passed.
if not exist "tests\run_tests.py" (
    echo ERROR: The tests are not part of an install package; run them in the project folder.
    exit /b 1
)
python tests\run_tests.py %ARGS%
exit /b %errorlevel%

rem ============================================================
:do_deploy
rem Install into a fixed folder, or update the installation there, from this
rem package: backup and files. See deploy.ps1.
if "%TARGET%"=="" goto :usage
if "%TARGET:~-1%"=="\" set "TARGET=%TARGET:~0,-1%"
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%deploy.ps1" -Target "%TARGET%" %DEPLOY_START%
exit /b %errorlevel%

rem ============================================================
rem  Helpers
rem ============================================================

:env_file
rem ENVFILE: the .env of the API folder next to this one, if there is one
set "ENVFILE="
if exist "..\ArchiXMIAPI\.env" set "ENVFILE=..\ArchiXMIAPI\.env"
if exist "..\ArchimateXMIAPI\.env" set "ENVFILE=..\ArchimateXMIAPI\.env"
if exist "..\ArchiMateAPI\.env" set "ENVFILE=..\ArchiMateAPI\.env"
exit /b 0

:usage
echo Usage:
echo   %SELF% install [options]  check Python, set up the API key, check the API, run
echo   %SELF% deploy folder [start]  from an unzipped package: install into that folder,
echo                             or update the installation there ^(backup, files^)
echo   %SELF% start [options]    start the browser on http://127.0.0.1:8090/
echo   %SELF% run [options]      start it and open the page in the default web browser
echo   %SELF% test [options]     run the tests
echo.
echo   Options go to server\serve.py, e.g. --port 9000, --api http://host:8000,
echo   --csp-allow http://127.0.0.1:8088; for test to tests\run_tests.py,
echo   e.g. --filter smoke, --headed, --serve.
echo.
echo   The API key comes from .env here (ARCHIXMI_API_KEY), else from the
echo   .env of the API folder next to this one (API_KEY).
exit /b 1
