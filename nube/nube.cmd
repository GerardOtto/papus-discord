@echo off
rem Atajo: nube\nube.cmd <comando> (ver nube\LEEME.md). Corre nube\nube.ts desde la raiz del repo.
cd /d "%~dp0.."
node --disable-warning=ExperimentalWarning --import tsx nube\nube.ts %*
