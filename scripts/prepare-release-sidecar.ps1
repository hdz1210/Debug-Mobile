$ErrorActionPreference = "Stop"

$mitmproxyVersion = "12.2.3"
$archiveSha256 = "04a01ea95ae96df75058a893e774957d294e69012dab1f4e256ce2b0c6725483"
$archiveUrl = "https://downloads.mitmproxy.org/$mitmproxyVersion/mitmproxy-$mitmproxyVersion-windows-x86_64.zip"

$projectRoot = Split-Path -Parent $PSScriptRoot
$downloadDirectory = Join-Path $projectRoot "runtime\release-inputs"
$archivePath = Join-Path $downloadDirectory "mitmproxy-$mitmproxyVersion-windows-x86_64.zip"
$resourceDirectory = Join-Path $projectRoot "src-tauri\release-resources"
$mitmdumpPath = Join-Path $resourceDirectory "mitmdump.exe"

New-Item -ItemType Directory -Force -Path $downloadDirectory, $resourceDirectory | Out-Null

function Test-ArchiveHash {
    if (-not (Test-Path -LiteralPath $archivePath -PathType Leaf)) {
        return $false
    }

    $actualHash = (Get-FileHash -LiteralPath $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
    return $actualHash -eq $archiveSha256
}

if (-not (Test-ArchiveHash)) {
    if (Test-Path -LiteralPath $archivePath) {
        Remove-Item -LiteralPath $archivePath -Force
    }

    Write-Host "Downloading mitmproxy $mitmproxyVersion from the official release archive..."
    Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath
}

if (-not (Test-ArchiveHash)) {
    throw "mitmproxy archive SHA-256 verification failed."
}

Add-Type -AssemblyName System.IO.Compression.FileSystem
$archive = [System.IO.Compression.ZipFile]::OpenRead($archivePath)
try {
    $entry = $archive.GetEntry("mitmdump.exe")
    if ($null -eq $entry) {
        throw "mitmdump.exe was not found in the verified archive."
    }

    [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $mitmdumpPath, $true)
}
finally {
    $archive.Dispose()
}

$metadata = Get-Item -LiteralPath $mitmdumpPath
Write-Host "Prepared $($metadata.FullName) ($($metadata.Length) bytes) from verified mitmproxy archive."
