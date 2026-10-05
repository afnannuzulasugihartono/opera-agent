# @last-edited: 2026-10-04 18:25 UTC+7.
# @title: run-transaction-worker-loss — hosted worker-loss launcher.
# @state: PowerShell 7 launcher for the hosted worker-loss probe.
# @dependencies: none stated.

param(
  [string]$RecoverNamespace
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'feat/semantic-runtime-1.6.0'
$CredentialDir = Join-Path $env:LOCALAPPDATA 'OperaAgent\transactions'
$CredentialFile = Join-Path $CredentialDir 'management-token.dpapi'

function Write-Step([string]$Text) {
  Write-Host "[worker-loss] $Text" -ForegroundColor Cyan
}

function Convert-SecureToPlain([Security.SecureString]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try {
    return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Get-ManagementToken {
  if ($env:OPERA_MANAGEMENT_TOKEN) {
    Write-Step 'Using OPERA_MANAGEMENT_TOKEN already present in this shell.'
    return $env:OPERA_MANAGEMENT_TOKEN
  }

  if (-not (Test-Path $CredentialFile)) {
    throw 'Encrypted management token was not found. Run the reviewed PKCE launcher once first.'
  }

  Write-Step 'Loading the locally encrypted Management token (Windows DPAPI).'
  $encrypted = Get-Content -LiteralPath $CredentialFile -Raw
  $secure = ConvertTo-SecureString $encrypted
  return Convert-SecureToPlain $secure
}

if ($PSVersionTable.PSVersion.Major -lt 7) {
  throw 'PowerShell 7+ (pwsh) is required for the worker-loss launcher.'
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
$token = $null
try {
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not installed or not on PATH.' }
  if (-not (Get-Command deno -ErrorAction SilentlyContinue)) { throw 'Deno is not installed or not on PATH.' }

  $dirty = @(git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
  if ($dirty.Count -gt 0) {
    throw 'Repository has local changes. Commit/stash them first; launcher will not overwrite user work.'
  }

  Write-Step 'Synchronizing the reviewed Milestone 8 branch.'
  git fetch origin $Branch --quiet
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }
  git switch $Branch --quiet
  if ($LASTEXITCODE -ne 0) { throw "Could not switch to $Branch." }
  git merge --ff-only "origin/$Branch" --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Local branch cannot be fast-forwarded safely.' }

  $head = (git rev-parse HEAD).Trim()
  Write-Step "Exact local HEAD: $head"

  if ($RecoverNamespace -and $RecoverNamespace -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') {
    throw 'RecoverNamespace is not a valid v4 UUID.'
  }

  $token = Get-ManagementToken
  if ($token -notmatch '^[A-Za-z0-9._~-]{16,8192}$') {
    throw 'Stored Management token format is invalid. Use the reviewed PKCE launcher to reset it.'
  }
  $env:OPERA_MANAGEMENT_TOKEN = $token

  $denoArgs = @(
    'run',
    '--allow-env=OPERA_MANAGEMENT_TOKEN',
    '--allow-net=api.supabase.com',
    '--allow-run',
    'tests/cloud/transaction-worker-loss.mjs'
  )
  if ($RecoverNamespace) {
    $denoArgs += @('--recover', $RecoverNamespace)
    Write-Step "Running bounded recovery for namespace $RecoverNamespace."
  } else {
    Write-Step 'Running hosted child-process death / lease-expiry / reclaim acceptance.'
    Write-Step 'Expected duration is roughly 30-45 seconds; no browser action is available to this probe.'
  }

  & deno @denoArgs 2>&1 | ForEach-Object { Write-Host ([string]$_) }
  $code = $LASTEXITCODE

  Write-Host ''
  if ($code -eq 0) {
    Write-Host 'WORKER-LOSS ACCEPTANCE: PASS' -ForegroundColor Green
  } else {
    Write-Host "WORKER-LOSS ACCEPTANCE: FAILED (exit $code)" -ForegroundColor Red
    Write-Host 'If a recovery namespace was printed, do not rerun the normal probe; use the reviewed recovery mode first.' -ForegroundColor Yellow
  }
  exit $code
} catch {
  Write-Host ''
  Write-Host "worker-loss launcher stopped: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  $env:OPERA_MANAGEMENT_TOKEN = $null
  $token = $null
  Pop-Location
}
