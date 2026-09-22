# Deploy opera-agent-gateway via Supabase Management API.
# Reads the DPAPI-protected management token directly; the token is NEVER
# printed. Preflights the token scope, deploys, verifies byte-exact, then
# smoke-tests the public surfaces. ASCII-only (PS 5.1 reads no-BOM as ANSI).
$ErrorActionPreference = 'Stop'
$ref = 'nenmkmtvjremqphfqnfw'
$fn  = 'opera-agent-gateway'
$localPath = Join-Path $PSScriptRoot 'opera-agent\supabase\functions\opera-agent-gateway\index.ts'
if (-not (Test-Path $localPath)) { $localPath = Join-Path $PSScriptRoot '..\supabase\functions\opera-agent-gateway\index.ts' }

# --- token (DPAPI): prefer a dedicated deploy token, fall back to the DB token ---
$deployTokPath = Join-Path $env:LOCALAPPDATA 'OperaAgent\8D\deploy-token.dpapi'
$tokPath = if (Test-Path $deployTokPath) { $deployTokPath } else { Join-Path $env:LOCALAPPDATA 'OperaAgent\8D\management-token.dpapi' }
Write-Host ('token source: ' + (Split-Path -Leaf $tokPath))
$enc = Get-Content -LiteralPath $tokPath -Raw
$sec = ConvertTo-SecureString $enc
$bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec)
try { $tok = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) } finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
if (-not $tok -or $tok.Length -lt 20) { throw 'DPAPI token decrypt failed' }

# --- preflight: token must be able to read functions (same scope family as deploy) ---
try {
  $list = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/functions" -Headers @{ Authorization = "Bearer $tok" }
  Write-Host ('preflight: functions:read OK (' + @($list).Count + ' functions known)')
} catch {
  throw ("preflight FAILED: token cannot read functions (" + $_.Exception.Message + ") - create a token with Write and Deploy scope")
}

# --- read source (UTF-8, normalized LF) ---
$bytes = [IO.File]::ReadAllBytes($localPath)
$src = [Text.Encoding]::UTF8.GetString($bytes) -replace "`r`n", "`n"
$bodyJson = @{
  metadata = @{ name = $fn; entrypoint_path = 'index.ts'; verify_jwt = $false }
  files    = @(@{ name = 'index.ts'; content = $src })
} | ConvertTo-Json -Depth 8

# --- deploy (bulk endpoint) ---
$resp = Invoke-RestMethod -Method Post `
  -Uri "https://api.supabase.com/v1/projects/$ref/functions/deploy?bulk=true" `
  -Headers @{ Authorization = "Bearer $tok" } `
  -ContentType 'application/json' -Body ([Text.Encoding]::UTF8.GetBytes($bodyJson))
Write-Host ('deploy response: ' + ($resp | ConvertTo-Json -Compress))

# --- verify: fetch served source, byte-match when available ---
$remote = Invoke-RestMethod -Method Get -Uri "https://api.supabase.com/v1/projects/$ref/functions/$fn" -Headers @{ Authorization = "Bearer $tok" }
Write-Host ('remote status: ' + $remote.status)
if ($remote.files -and @($remote.files).Count -gt 0) {
  $remoteSrc = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($remote.files[0].content)) -replace "`r`n", "`n"
  if ($remoteSrc -ne $src) { throw 'VERIFY FAILED: remote source differs from local source' }
  Write-Host ('verify: remote source byte-exact (' + $src.Length + ' chars)')
} else {
  Write-Host 'verify: function detail has no files payload - relying on smoke tests'
}

# --- smoke tests (public surfaces) ---
$base = "https://$ref.supabase.co/functions/v1/$fn"
$h = Invoke-RestMethod -Uri "$base/health"
Write-Host ('health: ' + ($h | ConvertTo-Json -Compress))
$o = Invoke-RestMethod -Uri "$base/openapi.json"
Write-Host ('openapi servers: ' + $o.servers[0].url)
Write-Host ('openapi paths: ' + ($o.paths.PSObject.Properties.Name -join ', '))
$c = Invoke-RestMethod -Method Post -Uri "$base/command" -ContentType 'application/json' -Body '{"method":"tabs.list"}'
Write-Host ('command no-token: ' + ($c | ConvertTo-Json -Compress))
Write-Host 'DEPLOY OK'
