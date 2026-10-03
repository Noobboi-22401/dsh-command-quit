@echo off
setlocal
rem The shim on PATH records the name it was installed under; run this file
rem directly and there is none, so fall back to the default name for the title
rem and the messages below.
if not defined DSH_QUIT_COMMAND_NAME set "DSH_QUIT_COMMAND_NAME=quit-dsh"
title %DSH_QUIT_COMMAND_NAME%

rem ---------------------------------------------------------------------------
rem Terminal launcher for the dsh-command-quit plugin.
rem
rem The shim on PATH calls this file, which finds a Node.js and runs
rem dsh-quit.mjs next to it. Keeping the search here means a machine with a new
rem Node.js install fixes itself without reinstalling the shim.
rem
rem DSH_QUIT_COMMAND_NAME is set by that shim to the name it was installed
rem under, and is passed straight through to the command, so its messages name
rem the user's own command instead of the default.
rem
rem This file is ASCII-only: cmd.exe reads a .cmd in the console's OEM code
rem page, so any non-ASCII text here would be mangled. The command's own
rem messages are printed by Node.js, which writes to a console in UTF-16 and
rem therefore shows Chinese correctly whatever the code page is.
rem
rem Node.js is located in four steps, first one that runs wins:
rem   1. DSH_QUIT_NODE, recorded by the shim when the plugin installed it
rem   2. node.exe on PATH (a separately installed Node.js, v18 or newer)
rem   3. a Node build bundled with DeepSeek Harness
rem   4. nothing found -> explain how to fix it and exit
rem
rem DSH_QUIT_ELECTRON=1 means the recorded executable is DeepSeek Harness.exe
rem itself, which runs as Node.js when ELECTRON_RUN_AS_NODE is set. That is the
rem same mechanism DSH's own dsh.cmd uses, so it needs no Node.js install.
rem ---------------------------------------------------------------------------

set "ENTRY=%~dp0dsh-quit.mjs"
set "NODE="

if not exist "%ENTRY%" goto :missing

if defined DSH_QUIT_NODE call :probe "%DSH_QUIT_NODE%"
if defined NODE goto :run

for %%I in (node.exe) do if not "%%~$PATH:I"=="" call :probe "%%~$PATH:I"
if defined NODE goto :run

call :find_bundled
if defined NODE goto :run
goto :no_node

:run
if /i "%DSH_QUIT_ELECTRON%"=="1" set "ELECTRON_RUN_AS_NODE=1"
"%NODE%" "%ENTRY%" %*
exit /b %ERRORLEVEL%

rem ===========================================================================
rem  helpers
rem ===========================================================================

:probe
rem Keep a candidate only if it really runs: a broken PATH entry can point at a
rem missing or non-executable stub, and the plugin's copy of the desktop
rem executable is only usable when ELECTRON_RUN_AS_NODE takes effect.
if defined NODE goto :eof
if not exist "%~1" goto :eof
"%~1" -v >nul 2>nul
if errorlevel 1 goto :eof
set "NODE=%~1"
goto :eof

:find_bundled
if defined DSH_HOME call :scan_runtimes "%DSH_HOME%\dsh-runtimes"
if defined DSH_APP_ASAR for %%A in ("%DSH_APP_ASAR%") do call :probe "%%~dpA\runtime\primary-runtime\dependencies\node\bin\node.exe"
if defined USERPROFILE call :scan_runtimes "%USERPROFILE%\.dsh\dsh-runtimes"
call :probe "%LOCALAPPDATA%\Programs\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :probe "%LOCALAPPDATA%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :probe "%LOCALAPPDATA%\Programs\DeepSeekHarness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :probe "%ProgramFiles%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :probe "%ProgramFiles(x86)%\DeepSeek Harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
call :probe "%ProgramFiles%\deepseek-harness\resources\runtime\primary-runtime\dependencies\node\bin\node.exe"
goto :eof

:scan_runtimes
for /d %%D in ("%~1\*") do call :probe "%%~fD\dependencies\node\bin\node.exe"
goto :eof

rem ===========================================================================
rem  failures
rem ===========================================================================

:no_node
echo.
echo   This command needs Node.js and could not find one.
echo.
echo   Tried, in this order:
echo     1. the executable the plugin recorded when it installed this command
echo     2. node.exe on PATH (Node.js 18 or newer)
echo     3. the Node build bundled with DeepSeek Harness
echo.
echo   To fix it, do one of these and run %DSH_QUIT_COMMAND_NAME% again:
echo     - install Node.js 18 or newer from https://nodejs.org
echo     - or reinstall the command: double-click install-dsh-quit.cmd
echo.
exit /b 1

:missing
echo.
echo   The dsh-command-quit plugin is incomplete: bin\dsh-quit.mjs is missing.
echo   Download the whole plugin folder, not just one file.
echo.
exit /b 1
