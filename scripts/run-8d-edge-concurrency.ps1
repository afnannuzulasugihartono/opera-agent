# @last-edited: 2026-10-04 18:25 UTC+7.
# @title: run-8d-edge-concurrency — 8d-edge-concurrency — Script.
# @state: publishable key defaults read env first.
# @dependencies: none stated.

param(
  [switch]$ResetCredential,
  [string]$RecoverNamespace,
  [switch]$RestoreMasterOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$Branch = 'feat/semantic-runtime-1.6.0'
$ProjectRef = if ($env:SUPABASE_PROJECT_REF) { $env:SUPABASE_PROJECT_REF } else { 'nenmkmtvjremqphfqnfw' }
$PublishableKey = if ($env:OPERA_AGENT_PUBLISHABLE_KEY) { $env:OPERA_AGENT_PUBLISHABLE_KEY } else { 'sb_publishable_jAbS_QIQsmXQA-Rj8RWPcg_JVeBedJ6' }
$CredentialDir = Join-Path $env:LOCALAPPDATA 'OperaAgent\8D'
$CredentialFile = Join-Path $CredentialDir 'management-token.dpapi'
$StateDir = '.opera-agent-8d-state'
$MasterSecretName = 'OPERA_AGENT_TRANSACTION_DARK_8D'
$ManagementSecretsUri = "https://api.supabase.com/v1/projects/$ProjectRef/secrets"

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

function Set-StaticMasterValue {
  param(
    [Parameter(Mandatory)][ValidateSet('true','false')][string]$Value,
    [Parameter(Mandatory)][string]$Credential
  )
  $payload = ConvertTo-Json -InputObject @(@{ name = $MasterSecretName; value = $Value }) -Compress
  $headers = @{
    Authorization = "Bearer $Credential"
    Accept = 'application/json'
  }
  $response = Invoke-WebRequest `
    -Method Post `
    -Uri $ManagementSecretsUri `
    -Headers $headers `
    -ContentType 'application/json' `
    -Body $payload `
    -SkipHttpErrorCheck
  if ([int]$response.StatusCode -ne 201) {
    throw "Static master update failed (HTTP $([int]$response.StatusCode))."
  }
}

function Restore-StaticMasterFalse {
  param([Parameter(Mandatory)][string]$Credential)
  $lastMessage = 'unknown restore failure'
  for ($attempt = 1; $attempt -le 3; $attempt++) {
    try {
      Set-StaticMasterValue -Value 'false' -Credential $Credential
      Write-Step 'Static Edge master restored to false.'
      return
    } catch {
      $lastMessage = $_.Exception.Message
      if ($attempt -lt 3) {
        Write-Host "[8D edge-concurrency] Static master restore attempt $attempt failed; retrying." -ForegroundColor Yellow
        Start-Sleep -Seconds $attempt
      }
    }
  }
  throw "STATIC_MASTER_RESTORE_FAILED after 3 attempts. Run RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly before any other 8D work. Last error: $lastMessage"
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
$token = $null
$restoreRequired = $false
$restoreFailed = $false
$exitCode = 1
Push-Location $repoRoot
try {
  if ($ResetCredential) {
    if (Test-Path $CredentialFile) { Remove-Item -LiteralPath $CredentialFile -Force }
    Write-Step 'Encrypted local Management token removed.'
    $exitCode = 0
  } else {
    if ($RestoreMasterOnly -and $RecoverNamespace) { throw '-RestoreMasterOnly cannot be combined with -RecoverNamespace.' }
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

    if ($RestoreMasterOnly) {
      Write-Step 'Running static-master recovery only; no OAuth, fixture, or Edge concurrency probe will run.'
      Restore-StaticMasterFalse -Credential $token
      Write-Host ''
      Write-Host '8D STATIC MASTER RESTORE: PASS' -ForegroundColor Green
      $exitCode = 0
    } else {
      $args = @()
      if ($RecoverNamespace) {
        if ($RecoverNamespace -notmatch '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$') { throw 'Recovery namespace format is invalid.' }
        Write-Step "Running reviewed recovery for namespace $RecoverNamespace. Static master remains false/off."
        $args = @('--recover', $RecoverNamespace)
      } else {
        Write-Step 'Establishing fail-closed static-master baseline (false).'
        Set-StaticMasterValue -Value 'false' -Credential $token
        $restoreRequired = $true
        Write-Step 'Temporarily enabling the static Edge master for exactly one reviewed probe.'
        Set-StaticMasterValue -Value 'true' -Credential $token
        $env:OPERA_8D_PUBLISHABLE_KEY = $PublishableKey
        Write-Step 'Running bounded real Edge concurrency acceptance.'
        Write-Step 'The OAuth page will open automatically; login grants connection only, not browser/transaction approval.'
      }

      $opened = $false
      & deno run `
        --node-modules-dir=auto `
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
      $exitCode = $code
    }
  }
} catch {
  Write-Host ''
  Write-Host "8D edge-concurrency launcher stopped: $($_.Exception.Message)" -ForegroundColor Red
  $exitCode = 1
} finally {
  if ($restoreRequired -and $token) {
    try {
      Restore-StaticMasterFalse -Credential $token
    } catch {
      $restoreFailed = $true
      Write-Host ''
      Write-Host "8D STATIC MASTER RESTORE FAILED: $($_.Exception.Message)" -ForegroundColor Red
      Write-Host 'Do not run another 8D probe. Run RUN_8D_EDGE_CONCURRENCY.cmd -RestoreMasterOnly first.' -ForegroundColor Yellow
    }
  }
  $env:OPERA_8D_MANAGEMENT_TOKEN = $null
  $env:OPERA_8D_PUBLISHABLE_KEY = $null
  $token = $null
  Pop-Location
}

if ($restoreFailed) { exit 1 }
exit $exitCode
