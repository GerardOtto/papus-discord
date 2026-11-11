@echo off
rem Mantiene los bots corriendo: si el programa se cierra o falla, lo reinicia a los 15 s.
rem Si se cerro a proposito (existe data\detener.flag: icono de la bandeja, npm run detener o el cierre de sesion de
rem Windows), no lo reinicia: las chicas ya se despidieron.
rem Lo lanza la tarea "Papus Discord" del Programador de tareas al iniciar sesion (sin ventana).
rem Registro: data\bots.log (al pasar 5 MB se guarda como data\bots.old.log).
cd /d "%~dp0.."
if not exist data mkdir data
:loop
if exist data\bots.log for %%A in (data\bots.log) do if %%~zA GTR 5000000 move /y data\bots.log data\bots.old.log > nul
echo [%date% %time%] arrancando los bots >> data\bots.log
call npm start >> data\bots.log 2>&1
if exist data\detener.flag (
  del /q data\detener.flag
  echo [%date% %time%] detenidos a pedido; no se reinician >> data\bots.log
  exit /b 0
)
echo [%date% %time%] el programa se cerro (codigo %errorlevel%); reinicio en 15 s >> data\bots.log
timeout /t 15 /nobreak > nul
goto loop
