@echo off
cd /d "%~dp0"
powershell -ExecutionPolicy Bypass -File atualizar-motoristas.ps1
echo.
echo ================================================
echo Concluido. Cadastro de motoristas atualizado a partir da planilha Agregados Escala.
echo ================================================
pause
