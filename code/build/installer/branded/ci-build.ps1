# Run this script from the pinned packaging checkout, not from the application tree.
[CmdletBinding()]
param(
    [Parameter(Mandatory)] [string] $SourceDirectory,
    [Parameter(Mandatory)] [ValidatePattern('^[0-9a-fA-F]{40}$')] [string] $SourceCommit,
    [Parameter(Mandatory)] [ValidatePattern('^[0-9a-fA-F]{40}$')] [string] $ToolingCommit,
    [Parameter(Mandatory)] [string] $OutputDirectory
)

$ErrorActionPreference = 'Stop'
if ($env:OS -ne 'Windows_NT') { throw 'The branded Windows installer requires a Windows build host.' }

$source = (Resolve-Path -LiteralPath $SourceDirectory).Path
$build = Join-Path $source 'code/build'
$app = Join-Path $source 'code/code'
$stage = [IO.Path]::GetFullPath($OutputDirectory)
$packager = Join-Path $build 'installer/branded'

function Assert-Checkout([string] $Directory, [string] $Expected, [string[]] $Paths) {
    $actual = & git -C $Directory rev-parse HEAD
    if ($LASTEXITCODE -ne 0 -or $actual -ne $Expected) { throw "Unexpected checkout at $Directory; expected $Expected." }
    $changes = & git -C $Directory status --porcelain --untracked-files=all -- @Paths
    if ($LASTEXITCODE -ne 0 -or $changes) { throw "Expected a clean source under $Directory." }
}
Assert-Checkout $source $SourceCommit @('code/code', 'code/build/package.json', 'code/build/package-lock.json',
    'code/build/electron-builder.json', 'code/build/installer/header.bmp', 'code/build/installer/sidebar.bmp', 'code/build/installer/installer.nsh')
Assert-Checkout $PSScriptRoot $ToolingCommit @('.')

$toolingFiles = @('build.cjs', 'Setup.cs', 'Setup.xaml', 'Setup.manifest', 'SetupEngine.cs')
if (-not (Test-Path -LiteralPath (Join-Path $build 'node_modules/electron-builder/package.json') -PathType Leaf)) {
    throw "Run npm ci --include=dev in $build first."
}
if (Test-Path -LiteralPath $stage) { throw "The staging directory must not already exist: $stage" }
if ($stage.Equals($source, [StringComparison]::OrdinalIgnoreCase) -or
    $stage.StartsWith($source + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'Stage the installer outside the application checkout.'
}
if ($PSScriptRoot -ne $packager) {
    New-Item -ItemType Directory -Force -Path $packager | Out-Null
    foreach ($name in $toolingFiles) {
        Copy-Item -LiteralPath (Join-Path $PSScriptRoot $name) -Destination (Join-Path $packager $name) -Force
    }
}

Push-Location -LiteralPath $build
try {
    # A read-only build: no release publishing, no installer launch.
    $log = & node (Join-Path $packager 'build.cjs') | ForEach-Object { Write-Host $_; $_ }
    if ($LASTEXITCODE -ne 0) { throw 'Branded Windows build failed.' }

    $exeLines = @($log | Where-Object { $_ -cmatch '^Built .+Dexerion-Setup-Branded\.exe$' })
    $hashLines = @($log | Where-Object { $_ -cmatch '^SHA-256: [0-9a-f]{64}$' })
    if ($exeLines.Count -ne 1 -or $hashLines.Count -ne 1) { throw 'Missing branded Windows build receipt.' }
    $wrapper = $exeLines[0].Substring('Built '.Length)
    $out = Split-Path -Parent $wrapper
    $stock = Join-Path $out 'Main_Exe_Dexerion.exe'
    $binary = Join-Path $out 'win-unpacked/Dexerion.exe'
    $asar = Join-Path $out 'win-unpacked/resources/app.asar'
    foreach ($path in @($wrapper, $stock, $binary, $asar)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required Windows build output is missing: $path" }
    }

    function Get-Sha256([string] $Path) {
        (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $assembly = [Reflection.Assembly]::LoadFile($wrapper)
    function Get-ResourceSha256([string] $Name) {
        $stream = $assembly.GetManifestResourceStream($Name)
        if ($null -eq $stream) { throw "Missing embedded resource $Name." }
        $sha = [Security.Cryptography.SHA256]::Create()
        try { ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '').ToLowerInvariant() }
        finally { $sha.Dispose(); $stream.Dispose() }
    }
    $installerHash = Get-Sha256 $wrapper
    $stockHash = Get-Sha256 $stock
    $binaryHash = Get-Sha256 $binary
    $xamlHash = Get-Sha256 (Join-Path $packager 'Setup.xaml')
    $logoHash = Get-Sha256 (Join-Path $app 'assets/logo.png')
    $infoStream = $assembly.GetManifestResourceStream('Dexerion.PayloadInfo')
    if ($null -eq $infoStream) { throw 'Missing installer metadata resource.' }
    $reader = [IO.StreamReader]::new($infoStream)
    try { $payload = $reader.ReadToEnd().Split([char]10) }
    finally { $reader.Dispose() }
    if ($installerHash -ne $hashLines[0].Substring('SHA-256: '.Length) -or
        $stockHash -ne (Get-ResourceSha256 'Dexerion.Nsis') -or
        $payload.Count -ne 7 -or $payload[1] -cne 'Dexerion.exe' -or $payload[2] -cne 'Dexerion' -or
        $payload[3] -ne $binaryHash -or $payload[6] -ne $stockHash -or
        $xamlHash -ne (Get-ResourceSha256 'Dexerion.SetupXaml') -or $logoHash -ne (Get-ResourceSha256 'Dexerion.BrandLogo')) {
        throw 'The installer, embedded stock NSIS, app metadata, UI, or logo did not match the expected bytes.'
    }

    # Representative main-app entry points and UI prove this is the app from the source checkout,
    # not an accidentally merged UI branch. Recheck the whole app working tree afterwards.
    $archive = @'
const { listPackage, extractFile } = require('@electron/asar');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const [archive, source] = process.argv.slice(2);
const normalize = name => name.split(String.fromCharCode(92)).join('/').replace(/^\/+/, '');
const files = listPackage(archive);
const expected = ['main.js', 'preload.js', 'src/main/profile.js', 'src/renderer/shell.css', 'assets/page-theme.css'];
const checks = {};
for (const item of expected) {
  const entry = files.find(file => normalize(file) === item);
  if (!entry) throw new Error('Missing packaged application file: ' + item);
  const packed = extractFile(archive, entry.slice(1));
  if (!packed.equals(fs.readFileSync(path.join(source, item)))) {
    throw new Error('Packaged bytes do not match pushed application source: ' + item);
  }
  checks[item] = crypto.createHash('sha256').update(packed).digest('hex');
}
console.log(JSON.stringify(checks));
'@ | & node - $asar $app
    if ($LASTEXITCODE -ne 0) { throw 'Packaged application verification failed.' }
    Assert-Checkout $source $SourceCommit @('code/code', 'code/build/package.json', 'code/build/package-lock.json',
        'code/build/electron-builder.json', 'code/build/installer/header.bmp', 'code/build/installer/sidebar.bmp', 'code/build/installer/installer.nsh')

    New-Item -ItemType Directory -Path $stage | Out-Null
    $name = 'Dexerion-Setup-Branded.exe'
    $stagedInstaller = Join-Path $stage $name
    Copy-Item -LiteralPath $wrapper -Destination $stagedInstaller
    if ((Get-Sha256 $stagedInstaller) -ne $installerHash) { throw 'Staged Windows installer hash mismatch.' }
    "$installerHash  $name" | Set-Content -LiteralPath (Join-Path $stage "$name.sha256") -Encoding ascii
    $version = (Get-Content -LiteralPath (Join-Path $build 'package.json') -Raw | ConvertFrom-Json).version
    $lock = Get-Content -LiteralPath (Join-Path $build 'package-lock.json') -Raw | ConvertFrom-Json -AsHashtable
    [ordered]@{
        schemaVersion = 1
        platform = 'windows-x64'
        sourceCommit = $SourceCommit.ToLowerInvariant()
        toolingCommit = $ToolingCommit.ToLowerInvariant()
        appVersion = $version
        node = (& node --version)
        electron = $lock.packages['node_modules/electron'].version
        electronBuilder = $lock.packages['node_modules/electron-builder'].version
        lockSha256 = Get-Sha256 (Join-Path $build 'package-lock.json')
        artifact = $name
        artifactBytes = (Get-Item -LiteralPath $stagedInstaller).Length
        artifactSha256 = $installerHash
        stockNsisSha256 = $stockHash
        appExeSha256 = $binaryHash
        appAsarSha256 = Get-Sha256 $asar
        installerXamlSha256 = $xamlHash
        installerLogoSha256 = $logoHash
        checkedApplicationFiles = ($archive | ConvertFrom-Json)
    } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $stage 'build-provenance.json') -Encoding utf8
    Write-Host "Verified Windows installer staged at $stagedInstaller"
}
finally { Pop-Location }
