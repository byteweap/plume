param(
  [Parameter(Mandatory = $true)]
  [string]$BundleRoot
)

$ErrorActionPreference = "Stop"
$bundlePath = (Resolve-Path $BundleRoot).Path
$nsisInstaller = @(Get-ChildItem -Path (Join-Path $bundlePath "nsis") -Filter "*.exe")
$msiInstaller = @(Get-ChildItem -Path (Join-Path $bundlePath "msi") -Filter "*.msi")

if ($nsisInstaller.Count -ne 1 -or $msiInstaller.Count -ne 1) {
  throw "Expected exactly one NSIS installer and one MSI installer."
}

function Invoke-InstallerProcess {
  param(
    [string]$FilePath,
    [string[]]$ArgumentList
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
  if ($process.ExitCode -notin @(0, 3010)) {
    throw "$FilePath failed with exit code $($process.ExitCode)."
  }
}

$installDirectory = Join-Path $env:LOCALAPPDATA "Plume"
if (Test-Path $installDirectory) {
  throw "Refusing to overwrite an existing Plume installation at $installDirectory."
}

Invoke-InstallerProcess -FilePath $nsisInstaller[0].FullName -ArgumentList @("/S")
$installedExecutable = Join-Path $installDirectory "plume.exe"
$uninstaller = Join-Path $installDirectory "uninstall.exe"
if (!(Test-Path $installedExecutable) -or !(Test-Path $uninstaller)) {
  throw "The NSIS installer did not create the expected application and uninstaller."
}

$installedSignature = Get-AuthenticodeSignature -LiteralPath $installedExecutable
if ($installedSignature.Status -ne "Valid") {
  throw "The installed Plume executable has an invalid Authenticode signature."
}

Invoke-InstallerProcess -FilePath $uninstaller -ArgumentList @("/S")
$deadline = (Get-Date).AddSeconds(60)
while ((Test-Path $installDirectory) -and (Get-Date) -lt $deadline) {
  Start-Sleep -Milliseconds 500
}
if (Test-Path $installDirectory) {
  throw "The NSIS uninstaller did not remove the Plume installation."
}

Invoke-InstallerProcess -FilePath "msiexec.exe" -ArgumentList @(
  "/i",
  $msiInstaller[0].FullName,
  "/qn",
  "/norestart"
)
Invoke-InstallerProcess -FilePath "msiexec.exe" -ArgumentList @(
  "/x",
  $msiInstaller[0].FullName,
  "/qn",
  "/norestart"
)

Write-Host "NSIS and MSI silent install/uninstall checks passed."
