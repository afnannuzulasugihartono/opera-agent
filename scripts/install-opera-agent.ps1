# @last-edited: 2026-10-06 01:05 UTC+7.
# @title: install-opera-agent — installs the extension into a chosen Chromium browser.
# @state: writes the per-user ExtensionInstallForcelist policy so the browser installs and then auto-updates.
# @dependencies: windows registry (HKCU Policies), the opera-agent-update update.xml endpoint.

# Installs Opera Agent without a Web Store. Each Chromium browser reads its own
# policy key, and ExtensionInstallForcelist points at an update.xml that serves a
# signed CRX. The browser then installs it on next start and re-checks that URL
# on its own, so the user never presses update.

[CmdletBinding()]
param(
    # The id Chrome derives from the CRX signing key. Override it when the key is rotated.
    [string] $ExtensionId = 'ofgemipoobcnbjkfanmofjbdonjapmgl',
    [string] $ProjectRef = 'nenmkmtvjremqphfqnfw',
    # Select browsers by number, or 'all'. An empty string installs into every one found.
    [string] $Choice = ''
)

$ErrorActionPreference = 'Stop'

# The policy hive is machine-protected on some installations: the user account
# gets ReadKey only and Administrators holds FullControl. Writing the policy is
# what makes the browser install without a Web Store, so elevate once rather
# than fail with a registry error the user cannot act on.
$principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Host 'Opera Agent needs administrator rights to write the browser policy.' -ForegroundColor Yellow
    Write-Host 'Accept the Windows prompt to continue.' -ForegroundColor Yellow
    $argList = @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', "`"$PSCommandPath`"")
    if ($ExtensionId -ne 'ofgemipoobcnbjkfanmofjbdonjapmgl') { $argList += @('-ExtensionId', $ExtensionId) }
    if ($ProjectRef -ne 'nenmkmtvjremqphfqnfw') { $argList += @('-ProjectRef', $ProjectRef) }
    if ($Choice) { $argList += @('-Choice', $Choice) }
    try {
        Start-Process -FilePath 'powershell.exe' -Verb RunAs -ArgumentList $argList -Wait
        exit $LASTEXITCODE
    }
    catch {
        Write-Host "Elevation was declined, so nothing was changed: $($_.Exception.Message)" -ForegroundColor Red
        exit 1
    }
}

function Write-Step { param($m) Write-Host "`n$m" -ForegroundColor Cyan }
function Write-Ok { param($m) Write-Host "  $m" -ForegroundColor Green }
function Write-Bad { param($m) Write-Host "  $m" -ForegroundColor Red }

# The x parameter is how the Chromium updater sends app metadata, and how this
# endpoint reads which extension is being asked about. Without it the endpoint
# falls back to a legacy id and serves an ancient release.
$updateUrl = "https://$ProjectRef.supabase.co/functions/v1/opera-agent-update/update.xml?x=id%3D$ExtensionId%26v%3D0"

Write-Step 'Opera Agent installer'
Write-Host "  extension id : $ExtensionId"
Write-Host "  update feed  : $updateUrl"

$chromium = @(
    @{ Name = 'Chrome';  Key = 'HKCU:\Software\Policies\Google\Chrome';            Exe = "$env:ProgramFiles\Google\Chrome\Application\chrome.exe" }
    @{ Name = 'Edge';    Key = 'HKCU:\Software\Policies\Microsoft\Edge';          Exe = "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe" }
    @{ Name = 'Brave';   Key = 'HKCU:\Software\Policies\BraveSoftware\Brave';      Exe = "$env:ProgramFiles\BraveSoftware\Brave-Browser\Application\brave.exe" }
    @{ Name = 'Opera';   Key = 'HKCU:\Software\Policies\OperaSoftware\Opera';      Exe = "$env:ProgramFiles\Opera\launcher.exe" }
)

$installed = $chromium | Where-Object { Test-Path $_.Exe }

Write-Step 'Browsers found on this machine'
if (-not $installed) {
    Write-Bad 'No supported Chromium browser was found.'
    Write-Host '  Opera Agent needs Chrome, Edge, Brave or Opera. Firefox does not support this policy.' -ForegroundColor Yellow
    exit 1
}
$i = 1
foreach ($b in $installed) {
    Write-Host ("  [{0}] {1,-7} {2}" -f $i, $b.Name, $b.Exe)
    $i++
}
Write-Host ("  [A] all of them")

if (-not $Choice) {
    $Choice = Read-Host "`nWhich browser? (number, A for all)"
}

$targets = if ($Choice -match '^[Aa]$') { $installed } else {
    $n = 0
    if ($Choice -match '^\d+$') { $n = [int]$Choice }
    if ($n -ge 1 -and $n -le $installed.Count) { @($installed[$n - 1]) } else { @() }
}

if (-not $targets) {
    Write-Bad 'Nothing selected. Nothing was changed.'
    exit 1
}

Write-Step 'Writing the install policy'
foreach ($b in $targets) {
    try {
        if (-not (Test-Path $b.Key)) { New-Item -Path $b.Key -Force | Out-Null }
        $listKey = Join-Path $b.Key 'ExtensionInstallForcelist'
        if (-not (Test-Path $listKey)) { New-Item -Path $listKey -Force | Out-Null }

        # REG_MULTI_SZ. Read the existing entries so a second run updates ours
        # in place instead of appending a duplicate every time.
        $existing = (Get-ItemProperty -Path $listKey -Name 'ExtensionInstallForcelist' -ErrorAction SilentlyContinue).ExtensionInstallForcelist
        $next = @()
        if ($existing) {
            $next = @($existing | Where-Object { $_ -notmatch [regex]::Escape($ExtensionId) })
        }
        $next += $updateUrl

        Set-ItemProperty -Path $listKey -Name 'ExtensionInstallForcelist' -Value $next -Type MultiString
        Write-Ok "$($b.Name): policy written"
    }
    catch {
        Write-Bad "$($b.Name): $($_.Exception.Message)"
    }
}

Write-Step 'Verify what was written'
foreach ($b in $targets) {
    $listKey = Join-Path $b.Key 'ExtensionInstallForcelist'
    $now = (Get-ItemProperty -Path $listKey -Name 'ExtensionInstallForcelist' -ErrorAction SilentlyContinue).ExtensionInstallForcelist
    if ($now -contains $updateUrl) { Write-Ok "$($b.Name): our feed is present" }
    else { Write-Bad "$($b.Name): our feed is MISSING" }
}

Write-Step 'Next'
Write-Host '  Close the browser completely, then open it again.'
Write-Host '  The extension installs on that start and updates by itself from then on.'
Write-Host '  If it does not appear, open the extensions page and check the policy was read.'