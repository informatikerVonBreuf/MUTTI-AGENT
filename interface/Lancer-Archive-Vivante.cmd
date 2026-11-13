@echo off
setlocal
cd /d "%~dp0"
where node.exe >nul 2>&1
if errorlevel 1 (
  echo Node.js 22.22 ou plus recent est requis.
  pause
  exit /b 1
)
set "NODE_OPTIONS=%NODE_OPTIONS% --use-system-ca"
set "FOLIO_DEPENDENCIES_MISSING="
if not exist "node_modules\react\package.json" set "FOLIO_DEPENDENCIES_MISSING=1"
if not exist "node_modules\three\package.json" set "FOLIO_DEPENDENCIES_MISSING=1"
if defined FOLIO_DEPENDENCIES_MISSING (
  set NODE_USE_SYSTEM_CA=1
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 goto erreur
)
echo Preparation de Folio / Archive vivante...
call npm.cmd run build
if errorlevel 1 goto erreur
echo.
echo Le serveur affichera son adresse locale ci-dessous.
echo Gardez cette fenetre ouverte pendant l'utilisation. Ctrl+C pour arreter.
echo.
call npm.cmd start
if errorlevel 1 goto erreur
exit /b 0
:erreur
echo Le lancement a rencontre une erreur. Consultez le message ci-dessus.
pause
exit /b 1
