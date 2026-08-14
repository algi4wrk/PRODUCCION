@echo off
rem ---------------------------------------------------------------------------
rem  PRODUCCION — doble clic para trabajar.
rem
rem  Levanta la aplicacion en este computador y abre el navegador. La otra
rem  maquina del molino entra por la direccion que aparece abajo; en ella no hay
rem  que instalar nada.
rem
rem  Requisito: Node.js instalado (nodejs.org, version LTS).
rem ---------------------------------------------------------------------------

rem Rutas absolutas contra la carpeta de este archivo, no contra donde se hizo
rem el clic: con otro directorio de trabajo la aplicacion abriria una base de
rem datos vacia en otro lado y pareceria que se perdieron los datos.
set "RAIZ=%~dp0"
set "DATABASE_PATH=%RAIZ%data\produccion.db"
set "PORT=3000"
set "HOST=0.0.0.0"

if not exist "%RAIZ%app\build\index.js" (
  echo.
  echo   Falta compilar la aplicacion. Una sola vez, dentro de la carpeta app:
  echo       npm ci
  echo       npm run build
  echo.
  pause
  exit /b 1
)

if not exist "%RAIZ%data" mkdir "%RAIZ%data"

echo.
echo   PRODUCCION esta corriendo.
echo.
echo   En este computador:    http://localhost:3000
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do (
  for /f "tokens=1" %%b in ("%%a") do echo   En el otro computador:  http://%%b:3000
)
echo.
echo   Base de datos:  %DATABASE_PATH%
echo.
echo   Deje esta ventana abierta mientras trabajen.
echo   Para cerrar el programa, cierre esta ventana.
echo.

start "" /b cmd /c "timeout /t 2 >nul & start http://localhost:3000/ordenes"

cd /d "%RAIZ%app"
node build
