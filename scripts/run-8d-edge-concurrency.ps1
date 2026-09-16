param(
  [switch]$ResetCredential,
  [string]$RecoverNamespace
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'feat/semantic-runtime-1.6.0'
$ProjectRef = 'nenmkmtvjremqphfqnfw'
$PublishableKey = 'sb_publishable_jAbS_QIQsmXQA-Rj8RWPcg_JVeBedJ6'
$CredentialDir = Join-Path $env:LOCALAPPDATA 'OperaAgent\8D'
$CredentialFile = Join-Path $CredentialDir 'management-token.dpapi'
$StateDir = '.opera-agent-8d-state'

function Write-Step([string]$Text) {
  Write-Host "[8D edge-concurrency] $Text" -ForegroundColor Cyan
}

function Convert-SecureToPlain([Security.SecureString]$Secure) {
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($Secure)
  try { return [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
  finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
}

function Get-ManagementToken {
  if ($env:OPERA_8D_MANAGEMENT_TOKEN) {
    Write-Step 'Using OPERA_8D_MANAGEMENT_TOKEN already present in this shell.'
    return $env:OPERA_8D_MANAGEMENT_TOKEN
  }
  if (Test-Path $CredentialFile) {
    Write-Step 'Loading the locally encrypted Management token (Windows DPAPI).'
    return Convert-SecureToPlain (ConvertTo-SecureString (Get-Content -LiteralPath $CredentialFile -Raw))
  }
  throw 'No locally encrypted 8D Management token exists. Run RUN_8D_ACCEPTANCE.cmd once to provision it safely.'
}

function Open-OAuthUrl([string]$Url) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Opera\opera.exe'),
    (Join-Path $env:ProgramFiles 'Opera\opera.exe'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Opera\opera.exe' } else { $null })
  ) | Where-Object { $_ -and (Test-Path $_) }
  if ($candidates.Count -gt 0) { Start-Process -FilePath $candidates[0] -ArgumentList @($Url) }
  else { Start-Process $Url }
}

$repoRoot = Split-Path -Parent $PSScriptRoot
Push-Location $repoRoot
try {
  if ($ResetCredential) {
    if (Test-Path $CredentialFile) { Remove-Item -LiteralPath $CredentialFile -Force }
    Write-Step 'Encrypted local Management token removed.'
    exit 0
  }
  if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'git is not installed or not on PATH.' }
  if (-not (Get-Command deno -ErrorAction SilentlyContinue)) { throw 'Deno is not installed or not on PATH.' }

  $dirty = @(git status --porcelain)
  if ($LASTEXITCODE -ne 0) { throw 'git status failed.' }
  if ($dirty.Count -gt 0) { throw 'Repository has local changes. Commit/stash them first; launcher will not overwrite user work.' }

  Write-Step 'Synchronizing the reviewed Milestone 8 branch.'
  git fetch origin $Branch --quiet
  if ($LASTEXITCODE -ne 0) { throw 'git fetch failed.' }
  git switch $Branch --quiet
  if ($LASTEXITCODE -ne 0) { throw "Could not switch to $Branch." }
  git merge --ff-only "origin/$Branch" --quiet
  if ($LASTEXITCODE -ne 0) { throw 'Local branch cannot be fast-forwarded safely.' }

  $head = (git rev-parse HEAD).Trim()
  Write-Step "Exact local HEAD: $head"
  $token = Get-ManagementToken
  if ($token -notmatch '^[A-Za-z0-9._~-]{16,8192}$') { throw 'Stored Management token format is invalid.' }
  $env:OPERA_8D_MANAGEMENT_TOKEN = $token

  $args = @()
  if ($RecoverNamespace) {
    if ($RecoverNamespace -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'Recovery namespace format is invalid.' }
    Write-Step "Running reviewed recovery for namespace $RecoverNamespace."
    $args = @('--recover', $RecoverNamespace)
  } else {
    $env:OPERA_8D_PUBLISHABLE_KEY = $PublishableKey
    Write-Step 'Running bounded real Edge concurrency acceptance.'
    Write-Step 'The OAuth page will open automatically; login grants connection only, not browser/transaction approval.'
  }

  $opened = $false
  & deno run `
    --allow-env=OPERA_8D_MANAGEMENT_TOKEN,OPERA_8D_PUBLISHABLE_KEY `
    "--allow-net=api.supabase.com,$ProjectRef.supabase.co,127.0.0.1:6276" `
    --allow-read `
    "--allow-write=$StateDir" `
    tests/cloud/transaction-edge-concurrency-8d.mjs @args 2>&1 | ForEach-Object {
      $line = [string]$_
      Write-Host $line
      if (-not $RecoverNamespace -and -not $opened -and $line -match '^https://') {
        $opened = $true
        try {
          Open-OAuthUrl $line
          Write-Step 'Temporary OAuth page opened. Complete login in Opera.'
        } catch {
          Write-Host '[8D edge-concurrency] Could not open Opera automatically; open the temporary URL shown above manually.' -ForegroundColor Yellow
        }
      }
    }
  $code = $LASTEXITCODE
  if ($code -eq 0) {
    Write-Host ''
    if ($RecoverNamespace) { Write-Host '8D EDGE CONCURRENCY RECOVERY: PASS' -ForegroundColor Green }
    else { Write-Host '8D EDGE CONCURRENCY ACCEPTANCE: PASS' -ForegroundColor Green }
  } else {
    Write-Host ''
    Write-Host "8D EDGE CONCURRENCY ACCEPTANCE: FAILED (exit $code)" -ForegroundColor Red
    Write-Host 'Do not rerun blindly if a recovery namespace was printed.' -ForegroundColor Yellow
  }
  exit $code
} catch {
  Write-Host ''
  Write-Host "8D edge-concurrency launcher stopped: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  $env:OPERA_8D_MANAGEMENT_TOKEN = $null
  $env:OPERA_8D_PUBLISHABLE_KEY = $null
  $token = $null
  Pop-Location
}
