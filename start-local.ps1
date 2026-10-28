param([switch]$NoBrowser)
$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$Url = "http://localhost:3001/fingerprint/"
$HealthUrl = "http://localhost:3001/health"
$LogDir = Join-Path $ProjectRoot "logs"
$LogFile = Join-Path $LogDir "local-server.log"
$ErrorLog = Join-Path $LogDir "local-server-error.log"

function Test-LocalServer {
  try {
    $response = Invoke-WebRequest -Uri $HealthUrl -UseBasicParsing -TimeoutSec 2
    $health = $response.Content | ConvertFrom-Json
    return $response.StatusCode -eq 200 -and $health.primaryDatabase -eq 'supabase'
  } catch {
    return $false
  }
}

New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

if (-not (Test-LocalServer)) {
  $env:PORT = '3001'
  $server = Start-Process `
    -FilePath (Get-Command node.exe -ErrorAction Stop).Source `
    -ArgumentList 'gym-access-system/server.js' `
    -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden `
    -RedirectStandardOutput $LogFile `
    -RedirectStandardError $ErrorLog `
    -PassThru

  $started = $false
  for ($i = 0; $i -lt 30; $i++) {
    if (Test-LocalServer) {
      $started = $true
      break
    }
    if ($server.HasExited) { break }
    Start-Sleep -Milliseconds 500
  }

  if (-not $started) {
    Write-Host "The local server did not respond at $HealthUrl."
    Write-Host "Check the log file here:"
    Write-Host $LogFile
    Write-Host $ErrorLog
    if (Test-Path -LiteralPath $ErrorLog) { Get-Content -LiteralPath $ErrorLog -Tail 12 }
    throw 'The Zenith server could not start. Check the logs shown above.'
  }
}

if (-not $NoBrowser) { Start-Process $Url }
Write-Host "Zenith fingerprint sync ready: $Url"
