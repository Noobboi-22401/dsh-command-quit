@echo off
setlocal
chcp 65001 >nul 2>nul
title Uninstall dsh-quit terminal command

rem ---------------------------------------------------------------------------
rem Removes the terminal quit command installed by install-dsh-quit.cmd.
rem
rem It deletes only files carrying the plugin's own marker, so a file the user
rem created with the same name is never touched. The client's own /quit-dsh
rem command is not affected.
rem
rem ASCII-only, for the same reason as install-dsh-quit.cmd: cmd.exe reads this
rem file in the OEM code page, and the Chinese text is printed by Node.js.
rem ---------------------------------------------------------------------------

set "TOOL=%~dp0tools\install-dsh-quit.mjs"
set "NODE="

if not exist "%TOOL%" goto :missing_tool

for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE=%%~$PATH:I"
if defined NODE call :probe "%NODE%"
if defined NODE goto :run

set "NODE="
call :find_bundled
if defined NODE call :probe "%NODE%"
if defined NODE goto :run

for %%I in (node.exe) do if not "%%~$PATH:I"=="" set "NODE=%%~$PATH:I"
if defined NODE goto :run
goto :no_node

:run
echo   [Node] %NODE%
"%NODE%" "%TOOL%" --uninstall
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
echo %cmdcmdline% | find /i "%~nx0" | find /i "/c" >nul
if errorlevel 1 goto :eof
pause
goto :eof

rem ===========================================================================
rem  failures
rem ===========================================================================

:no_node
echo.
echo   Node.js was not found, so nothing can be removed automatically.
echo.
echo   Install Node.js 18 or newer from https://nodejs.org, or delete the two
echo   files named after your terminal command (quit-dsh.cmd and quit-dsh by
echo   default) from DeepSeek Harness's command directory by hand. It is the
echo   directory that also holds dsh.cmd.
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
