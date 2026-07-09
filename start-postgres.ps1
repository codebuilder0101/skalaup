# Starts the local SkalaUp PostgreSQL instance (port 5433).
# Run this after a machine reboot — the DB is not a Windows service.
$bin  = "C:\Users\Administrator\skalaup-pg\pgsql\bin"
$data = "C:\Users\Administrator\skalaup-pg\data"
$log  = "C:\Users\Administrator\skalaup-pg\pg.log"

$status = & (Join-Path $bin "pg_ctl.exe") -D $data status 2>&1 | Out-String
if ($status -match "server is running") {
  Write-Host "PostgreSQL already running." -ForegroundColor Green
} else {
  & (Join-Path $bin "pg_ctl.exe") -D $data -l $log -o "-p 5433" start
}
& (Join-Path $bin "pg_ctl.exe") -D $data status 2>&1 | Select-Object -First 1
