# prepare-www.ps1 -- build the www/ folder (physical copy, no bundler)
# ASCII only on purpose: PowerShell 5.1 mis-reads UTF-8 without BOM.
# Usage: node.exe is not required here; pure file copy.
param([string]$Root = (Split-Path -Parent $PSScriptRoot))

$ErrorActionPreference = 'Stop'
$www    = Join-Path $Root 'www'
$cordova= Join-Path $Root 'cordova'
$excludeFiles = @('*.bat', '*.md', '*.ps1', 'tests', 'tools', '.git', '.gitignore', 'design', 'docs', 'production', 'package.json', 'package-lock.json')
$excludeDirs  = @('tests', 'tools', 'design', 'docs', 'production', 'www', 'cordova', '.git', 'node_modules', 'prototypes')

Write-Host "[prepare] cleaning $www"
if (Test-Path $www) { Remove-Item $www -Recurse -Force }
New-Item -ItemType Directory -Path $www | Out-Null

Write-Host "[prepare] copying index.html, src/, assets/"
Copy-Item (Join-Path $Root 'index.html') -Destination $www -Force
foreach ($d in @('src', 'assets')) {
  $from = Join-Path $Root $d
  if (Test-Path $from) { Copy-Item $from -Destination (Join-Path $www $d) -Recurse -Force }
}

Write-Host "[prepare] validating JSON data files"
$node = Get-ChildItem "$env:USERPROFILE\.workbuddy\binaries\node\versions\*\node-v*-win-x64\node.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
$dataDir = Join-Path $www 'assets\data'
if ((Test-Path $dataDir) -and $node) {
  Get-ChildItem $dataDir -Filter *.json | ForEach-Object {
    & $node.FullName -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8')); console.log('  json ok: ' + process.argv[1])" $_.FullName
    if ($LASTEXITCODE -ne 0) { throw "invalid JSON: $($_.Name)" }
  }
}

Write-Host "[prepare] syncing www -> cordova/www"
$cw = Join-Path $cordova 'www'
if (-not (Test-Path $cordova)) { New-Item -ItemType Directory -Path $cordova | Out-Null }
if (Test-Path $cw) { Remove-Item $cw -Recurse -Force }
Copy-Item $www -Destination $cw -Recurse -Force

Write-Host "[prepare] done. www/ is the Pages artifact and the Cordova web root."
