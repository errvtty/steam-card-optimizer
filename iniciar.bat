@echo off
if not exist node_modules (call npm install)
start http://localhost:3000
npm start
