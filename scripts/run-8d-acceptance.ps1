param(
  [switch]$ResetCredential
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
  Write-Host "[8D] $Text" -ForegroundColor Cyan
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
  if ($env:OPERA_8D_MANAGEMENT_TOKEN) {
    Write-Step 'Using OPERA_8D_MANAGEMENT_TOKEN already present in this shell.'
    return $env:OPERA_8D_MANAGEMENT_TOKEN
  }

  if (Test-Path $CredentialFile) {
    Write-Step 'Loading the locally encrypted Management token (Windows DPAPI).'
    $encrypted = Get-Content -LiteralPath $CredentialFile -Raw
    $secure = ConvertTo-SecureString $encrypted
    return Convert-SecureToPlain $secure
  }

  Write-Host ''
  Write-Host 'First run only: a Supabase Management Personal Access Token is required.' -ForegroundColor Yellow
  Write-Host 'The token will NOT be stored in the repository. It is encrypted with Windows DPAPI for this Windows user.' -ForegroundColor Yellow
  Write-Host 'If you do not have one yet, the Supabase token page will open now.' -ForegroundColor Yellow
  try { Start-Process 'https://supabase.com/dashboard/account/tokens' } catch {}
  Write-Host ''
  $secure = Read-Host 'Paste the Management token here (input is hidden)' -AsSecureString
  $plain = Convert-SecureToPlain $secure
  if ($plain -notmatch '^[A-Za-z0-9._~-]{16,8192}$') {
    throw 'The supplied Management token format is invalid. Nothing was saved.'
  }

  New-Item -ItemType Directory -Force -Path $CredentialDir | Out-Null
  $secure | ConvertFrom-SecureString | Set-Content -LiteralPath $CredentialFile -Encoding ASCII -NoNewline
  Write-Step 'Encrypted credential saved outside the repository.'
  return $plain
}

function Open-OAuthUrl([string]$Url) {
  $candidates = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Opera\opera.exe'),
    (Join-Path $env:ProgramFiles 'Opera\opera.exe'),
    $(if (${env:ProgramFiles(x86)}) { Join-Path ${env:ProgramFiles(x86)} 'Opera\opera.exe' } else { $null })
  ) | Where-Object { $_ -and (Test-Path $_) }

  if ($candidates.Count -gt 0) {
    Start-Process -FilePath $candidates[0] -ArgumentList @($Url)
  } else {
    Start-Process $Url
  }
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

  $token = Get-ManagementToken
  if ($token -notmatch '^[A-Za-z0-9._~-]{16,8192}$') { throw 'Stored Management token format is invalid. Run with -ResetCredential and try again.' }

  $env:OPERA_8D_MANAGEMENT_TOKEN = $token
  $env:OPERA_8D_PUBLISHABLE_KEY = $PublishableKey

  Write-Step 'Starting reviewed 8D acceptance runner. Production preflight runs before OAuth.'
  Write-Step 'When the temporary OAuth URL appears, this launcher will open it automatically in Opera/default browser.'

  $opened = $false
  & deno run `
    --allow-env=OPERA_8D_MANAGEMENT_TOKEN,OPERA_8D_PUBLISHABLE_KEY `
    "--allow-net=api.supabase.com,$ProjectRef.supabase.co,127.0.0.1:6276" `
    --allow-read `
    "--allow-write=$StateDir" `
    tests/cloud/transaction-cloud-acceptance-8d.mjs 2>&1 | ForEach-Object {
      $line = [string]$_
      Write-Host $line
      if (-not $opened -and $line -match '^https://') {
        $opened = $true
        try {
          Open-OAuthUrl $line
          Write-Step 'Temporary OAuth page opened. Complete the login in Opera; no transaction/browser mutation is approved by this login.'
        } catch {
          Write-Host '[8D] Could not open Opera automatically; open the temporary URL shown above manually.' -ForegroundColor Yellow
        }
      }
    }
  $code = $LASTEXITCODE

  if ($code -eq 0) {
    Write-Host ''
    Write-Host '8D PKCE ACCEPTANCE: PASS' -ForegroundColor Green
  } else {
    Write-Host ''
    Write-Host "8D PKCE ACCEPTANCE: FAILED (exit $code)" -ForegroundColor Red
    Write-Host 'Do not rerun blindly if a recovery namespace was printed; keep the terminal output and use the reviewed recovery command.' -ForegroundColor Yellow
  }
  exit $code
} catch {
  Write-Host ''
  Write-Host "8D launcher stopped: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
} finally {
  $env:OPERA_8D_MANAGEMENT_TOKEN = $null
  $env:OPERA_8D_PUBLISHABLE_KEY = $null
  $token = $null
  Pop-Location
}
