@echo off
REM Claude Skills System Installation Script for Windows
REM This script sets up the Claude Skills System on Windows

setlocal enabledelayedexpansion

REM Colors (using echo with escape sequences doesn't work well in Windows batch)
REM So we'll use simple text indicators

echo ================================
echo   Claude Skills System Installer
echo ================================
echo.

REM Check if running from the claude-skills-system directory
if not exist "install.bat" (
    echo [ERROR] Please run this script from the claude-skills-system directory
    exit /b 1
)

REM Get paths
set "CLAUDE_DIR=%USERPROFILE%\.claude"
set "SKILLS_DIR=%CLAUDE_DIR%\skills"
set "BIN_DIR=%USERPROFILE%\bin"

echo [INFO] Installation paths:
echo   Claude config: %CLAUDE_DIR%
echo   Skills directory: %SKILLS_DIR%
echo   Executables: %BIN_DIR%
echo.

REM Ask for confirmation
set /p "confirm=Continue with installation? (y/N) "
if /i not "%confirm%"=="y" (
    echo [!] Installation cancelled
    exit /b 0
)

REM Create directories
echo [INFO] Creating directories...
if not exist "%CLAUDE_DIR%" mkdir "%CLAUDE_DIR%"
if not exist "%SKILLS_DIR%" mkdir "%SKILLS_DIR%"
if not exist "%BIN_DIR%" mkdir "%BIN_DIR%"
echo [OK] Directories created
echo.

REM Check if skills already exist and back them up
dir /b "%SKILLS_DIR%" >nul 2>&1
if %errorlevel%==0 (
    for /f %%i in ('powershell -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set datetime=%%i
    set "BACKUP_DIR=%CLAUDE_DIR%\skills-backup-!datetime!"
    echo [!] Existing skills found. Backing up to !BACKUP_DIR!
    move "%SKILLS_DIR%" "!BACKUP_DIR!" >nul
    mkdir "%SKILLS_DIR%"
)

REM Copy skills
echo [INFO] Installing skills...
xcopy /s /e /y "skills\*" "%SKILLS_DIR%\" >nul
for /f %%A in ('dir /b "%SKILLS_DIR%\*.md" 2^>nul ^| find /c /v ""') do set SKILL_COUNT=%%A
echo [OK] Installed %SKILL_COUNT% skills
echo.

REM Install executables
echo [INFO] Installing executables...

REM Copy load-skills.js
copy /y "bin\load-skills.js" "%BIN_DIR%\load-skills.js" >nul
echo [OK] Installed load-skills.js

REM Create load-skills.cmd wrapper
echo @echo off > "%BIN_DIR%\load-skills.cmd"
echo node "%BIN_DIR%\load-skills.js" %%* >> "%BIN_DIR%\load-skills.cmd"
echo [OK] Created load-skills.cmd wrapper

REM Copy load-skills.py
copy /y "bin\load-skills.py" "%BIN_DIR%\load-skills.py" >nul
echo [OK] Installed load-skills.py

REM Copy claude-skills
copy /y "bin\claude-skills" "%BIN_DIR%\claude-skills.js" >nul

REM Create claude-skills.cmd wrapper
echo @echo off > "%BIN_DIR%\claude-skills.cmd"
echo node "%BIN_DIR%\claude-skills.js" %%* >> "%BIN_DIR%\claude-skills.cmd"
echo [OK] Created claude-skills.cmd wrapper
echo.

REM Check if bin is in PATH
echo %PATH% | findstr /i /c:"%BIN_DIR%" >nul
if errorlevel 1 (
    echo [!] %BIN_DIR% is not in your PATH
    echo.
    echo To add it permanently, run this command in an elevated command prompt:
    echo   setx PATH "%%PATH%%;%BIN_DIR%"
    echo.
    echo Or add it through System Properties ^> Environment Variables
    echo.
)

REM Check for Node.js
where node >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('node --version') do set NODE_VERSION=%%i
    echo [OK] Node.js found: !NODE_VERSION!
) else (
    echo [!] Node.js not found. Node.js is required for the JavaScript tools.
    echo     Download from: https://nodejs.org/
)

REM Check for Python
where python >nul 2>&1
if %errorlevel%==0 (
    for /f "tokens=*" %%i in ('python --version 2^>^&1') do set PYTHON_VERSION=%%i
    echo [OK] Python found: !PYTHON_VERSION!
) else (
    where python3 >nul 2>&1
    if !errorlevel!==0 (
        for /f "tokens=*" %%i in ('python3 --version 2^>^&1') do set PYTHON_VERSION=%%i
        echo [OK] Python found: !PYTHON_VERSION!
    ) else (
        echo [!] Python not found. Python 3 is required for the Python tools.
        echo     Download from: https://www.python.org/
    )
)
echo.

REM Create example CLAUDE.md if it doesn't exist
if not exist "%CLAUDE_DIR%\CLAUDE.md" (
    echo [INFO] Creating example CLAUDE.md...
    (
        echo # Claude Global Instructions
        echo.
        echo This file contains global instructions that apply to all projects.
        echo.
        echo ## General Rules
        echo.
        echo - Always read existing code before making changes
        echo - Follow the project's existing patterns and conventions
        echo - Write minimal, focused changes
        echo - Provide clear commit messages
        echo.
        echo ## Important Reminders
        echo.
        echo - Test your changes before committing
        echo - Document any new functions or complex logic
        echo - Handle errors appropriately
    ) > "%CLAUDE_DIR%\CLAUDE.md"
    echo [OK] Created example CLAUDE.md
) else (
    echo [INFO] CLAUDE.md already exists, skipping
)
echo.

REM Test the installation
echo [INFO] Testing installation...
echo.

REM Try to run claude-skills
where claude-skills >nul 2>&1
if %errorlevel%==0 (
    echo [OK] claude-skills command is available
) else (
    if exist "%BIN_DIR%\claude-skills.cmd" (
        echo [OK] claude-skills installed at %BIN_DIR%\claude-skills.cmd
        echo [!] You may need to restart your terminal or add %BIN_DIR% to PATH
    ) else (
        echo [ERROR] claude-skills command not found
    )
)

echo.
echo [OK] Installation complete!
echo.

REM Print next steps
echo Next Steps:
echo 1. If %BIN_DIR% wasn't in your PATH, add it and restart your terminal
echo 2. Navigate to a project directory and run: claude-skills init
echo 3. Add skills to your project: claude-skills add ^<skill-name^>
echo 4. View available skills: claude-skills list
echo 5. Load skills for Claude: load-skills
echo.
echo For Slack integration examples, see: .\slack-integrations\
echo For documentation, see: .\README.md
echo.

REM Optional: Show example projects
set /p "show_examples=Would you like to see example project configurations? (y/N) "
if /i "%show_examples%"=="y" (
    echo.
    echo [INFO] Example project configurations:
    echo.

    for /r "examples\projects" %%F in (.claude-skills*) do (
        echo   %%F
        type "%%F"
        echo.
    )
)

pause