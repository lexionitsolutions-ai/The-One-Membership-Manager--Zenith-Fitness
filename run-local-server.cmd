@echo off
cd /d "%~dp0"

if not exist logs mkdir logs
set "PORT=3001"
npm.cmd run start:dashboard > "logs\local-server.log" 2>&1
