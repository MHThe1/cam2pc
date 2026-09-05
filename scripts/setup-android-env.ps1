<#
.SYNOPSIS
  Installs minimal Android development tools (ADB + Platform Tools + Java) without needing Android Studio.
#>

$ErrorActionPreference = "Stop"

Write-Host "==> Checking Java / JDK 17..." -ForegroundColor Cyan
$javaHome = [Environment]::GetEnvironmentVariable("JAVA_HOME", "User")
if (-not $javaHome -or -not (Test-Path "$javaHome\bin\java.exe")) {
    $jdkPath = "C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot"
    if (Test-Path "$jdkPath\bin\java.exe") {
        Write-Host "Found OpenJDK 17 at $jdkPath" -ForegroundColor Green
        [Environment]::SetEnvironmentVariable("JAVA_HOME", $jdkPath, "User")
        $env:JAVA_HOME = $jdkPath
    } else {
        Write-Host "Installing OpenJDK 17 via winget..." -ForegroundColor Yellow
        winget install --id Microsoft.OpenJDK.17 --silent --accept-package-agreements --accept-source-agreements
    }
}

# Setup Android SDK Root directory
$androidSdkDir = "$env:LOCALAPPDATA\Android\Sdk"
$platformToolsDir = "$androidSdkDir\platform-tools"

if (-not (Test-Path $androidSdkDir)) {
    New-Item -ItemType Directory -Path $androidSdkDir -Force | Out-Null
}

# Download Google Platform Tools (ADB + fastboot - ~12MB)
if (-not (Test-Path "$platformToolsDir\adb.exe")) {
    Write-Host "==> Downloading official Android Platform Tools (ADB)..." -ForegroundColor Cyan
    $zipPath = "$env:TEMP\platform-tools.zip"
    Invoke-WebRequest -Uri "https://dl.google.com/android/repository/platform-tools-latest-windows.zip" -OutFile $zipPath
    
    Write-Host "==> Extracting platform-tools to $androidSdkDir..." -ForegroundColor Cyan
    Expand-Archive -Path $zipPath -DestinationPath $androidSdkDir -Force
    Remove-Item $zipPath -Force
}

# Configure Environment Variables
[Environment]::SetEnvironmentVariable("ANDROID_HOME", $androidSdkDir, "User")
$env:ANDROID_HOME = $androidSdkDir

$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*platform-tools*") {
    $newPath = "$userPath;$platformToolsDir"
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
    $env:Path = "$env:Path;$platformToolsDir"
}

Write-Host "`nSUCCESS: Android tools configured!" -ForegroundColor Green
Write-Host "  ANDROID_HOME: $androidSdkDir"
Write-Host "  ADB location: $platformToolsDir\adb.exe"

# Test adb
& "$platformToolsDir\adb.exe" version
