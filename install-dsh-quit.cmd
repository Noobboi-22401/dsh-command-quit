@echo off
setlocal
chcp 65001 >nul 2>nul
title Install dsh-quit terminal command

rem ---------------------------------------------------------------------------
rem ASCII-only launcher. The Chinese text is printed by
rem tools\install-dsh-quit.mjs, because cmd.exe reads this file in the OEM code
rem page and would mangle non-ASCII characters here.
rem
rem Node.js is located in three steps:
rem   1. node.exe on PATH (a separately installed Node.js, needs v18 or newer)
rem   2. a Node build bundled with DeepSeek Harness
rem   3. nothing found -> explain how to fix it and exit
rem
rem The client does NOT have to be closed: this only writes a launcher into
rem DSH's own command directory, never into the client's files.
rem ---------------------------------------------------------------------------

set "TOOL=%~dp0tools\install-dsh-quit.mjs"
set "NODE="

if not exist "%TOOL%" goto :missing_tool

rem --- step 1: a Node.js installed on this machine (PATH) ---------------------
for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE=%%~$PATH:I"
if defined NODE call :probe "%NODE%"
if defined NODE goto :run

rem --- step 2: the Node build bundled with DeepSeek Harness -------------------
set "NODE="
call :find_bundled
if defined NODE call :probe "%NODE%"
if defined NODE goto :run

rem --- step 3: a system Node that failed the probe is still better than none --
for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE=%%~$PATH:I"
if defined NODE goto :run
goto :no_node

:run
echo   [Node] %NODE%
"%NODE%" "%TOOL%" %*
set "RC=%ERRORLEVEL%"
echo.
call :pause_if_double_clicked
exit /b %RC%

rem ===========================================================================
rem  helpers
rem ===========================================================================

:probe
echo %NODE% | findstr /i "node" >nul
if errorlevel 1 set "NODE="
"%~1" -v 2>nul | findstr /r "^v[0-9]" >nul
if errorlevel 1 set "NODE="
goto :eof

:find_bundled
if defined DSH_HOME call :scan_runtimes "%DSH_HOME%\dsh-runtimes"
if defined DSH_APP_ASAR for %%A in ("%DSH_APP_ASAR%") do call :try "%%~dpA\runtime\primary-runtime\dependencies\node\bin\node.exe"
if defined USERPROFILE call :scan_runtimes "%USERPROFILE%\.dsh\dsh-runtimes"
call :try "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :try "%ProgramFiles%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :try "%ProgramFiles(x86)%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :try "%LOCALAPPDATA%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :try "%LOCALAPPDATA%\Programs\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :try "%ProgramFiles%\deepseek-harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
goto :eof

:scan_runtimes
for /d %%D in ("%~1\*") do call :try "%%~fD\dependencies\node\bin\node.exe"
goto :eof

:try
if defined NODE goto :eof
if exist "%~1" set "NODE=%~1"
goto :eof

:pause_if_double_clicked
rem cmd.exe appends /c to the command line only for the interactive
rem double-click case; a script run from an existing console has no /c, and
rem must not stall waiting for a keypress it will never get.
echo %cmdcmdline% | find /i "%~nx0" | find /i "/c" >nul
if errorlevel 1 goto :eof
pause
goto :eof

rem ===========================================================================
rem  failures
rem ===========================================================================

:no_node
echo.
echo   Node.js was not found.
echo.
echo   Tried, in this order:
echo     1. node.exe on PATH (Node.js 18 or newer)
echo     2. the Node build bundled with DeepSeek Harness
echo.
echo   To fix it, do one of these and double-click this file again:
echo     - install Node.js 18 or newer from https://nodejs.org
echo     - or set DSH_HOME to your DeepSeek Harness home directory
echo.
call :pause_if_double_clicked
exit /b 1

:missing_tool
echo.
echo   tools\install-dsh-quit.mjs is missing next to this launcher.
echo   Download the whole plugin folder, not just this .cmd file.
echo.
call :pause_if_double_clicked
exit /b 1
