# @last-edited: 2026-10-06 01:40 UTC+7.
# @title: build-installer — compiles the Opera Agent installer window into an .exe.
# @state: uses the C# compiler that ships with .NET Framework, so no toolchain install.
# @dependencies: csc.exe, WinForms, Drawing, OperaAgentInstaller.cs, installer.manifest.

# Compiles the installer with the C# compiler already present on Windows. The
# manifest is what makes Windows ask for administrator rights at launch, which
# the browser policy needs because HKCU\Software\Policies is ReadKey for a
# normal account on many machines.

$ErrorActionPreference = 'Stop'

$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = Split-Path -Parent $here
$src = Join-Path $here 'OperaAgentInstaller.cs'
$manifest = Join-Path $here 'installer.manifest'
$out = Join-Path $repo 'landing\OperaAgent-Installer.exe'

$csc = Get-ChildItem 'C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe' -ErrorAction SilentlyContinue
if (-not $csc) { throw 'csc.exe not found; .NET Framework is required' }

& $csc.FullName /nologo /target:winexe /platform:anycpu /optimize+ `
    /reference:System.dll /reference:System.Drawing.dll /reference:System.Windows.Forms.dll `
    "/win32manifest:$manifest" "/out:$out" $src

if ($LASTEXITCODE -ne 0) { throw "compile failed with exit code $LASTEXITCODE" }
if (-not (Test-Path $out)) { throw 'no exe produced' }

$info = Get-Item $out
Write-Output "built: $($info.FullName)"
Write-Output "bytes: $($info.Length)"
Write-Output "sha256: $((Get-FileHash $out -Algorithm SHA256).Hash.ToLower())"