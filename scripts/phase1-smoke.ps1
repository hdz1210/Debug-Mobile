param(
    [string]$MitmdumpPath = ""
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$smokeDirectory = Join-Path $projectRoot "runtime\phase1-smoke"
New-Item -ItemType Directory -Force -Path $smokeDirectory | Out-Null

$serverOutput = Join-Path $smokeDirectory "server.stdout.log"
$serverError = Join-Path $smokeDirectory "server.stderr.log"
$proxyOutput = Join-Path $smokeDirectory "mitmdump.stdout.log"
$proxyError = Join-Path $smokeDirectory "mitmdump.stderr.log"
$python = Join-Path $projectRoot ".venv\Scripts\python.exe"
$mitmdump = if ($MitmdumpPath) {
    [System.IO.Path]::GetFullPath($MitmdumpPath)
}
else {
    Join-Path $projectRoot ".venv\Scripts\mitmdump.exe"
}
$addon = Join-Path $projectRoot "src-tauri\addons\bridge.py"
$confDirectory = Join-Path $smokeDirectory "mitmproxy"

$server = Start-Process `
    -FilePath $python `
    -ArgumentList @("-m", "http.server", "19080", "--bind", "127.0.0.1", "--directory", $projectRoot) `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $serverOutput `
    -RedirectStandardError $serverError `
    -PassThru `
    -WindowStyle Hidden

$proxyArguments = @(
    "--listen-host", "127.0.0.1",
    "--listen-port", "18080",
    "--set", "confdir=$confDirectory",
    "--set", "appdbg_body_limit=1000000",
    "--set", "termlog_verbosity=error",
    "-s", $addon
)

$proxy = Start-Process `
    -FilePath $mitmdump `
    -ArgumentList $proxyArguments `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $proxyOutput `
    -RedirectStandardError $proxyError `
    -PassThru `
    -WindowStyle Hidden

try {
    Start-Sleep -Seconds 3

    if ($server.HasExited) {
        throw "HTTP test server exited with code $($server.ExitCode)"
    }
    if ($proxy.HasExited) {
        throw "mitmdump exited with code $($proxy.ExitCode)"
    }

    $previousNoProxy = $env:NO_PROXY
    try {
        $env:NO_PROXY = ""
        curl.exe `
            --silent `
            --show-error `
            --fail `
            --proxy "http://127.0.0.1:18080" `
            "http://127.0.0.1:19080/README.md" |
            Out-Null
        if ($LASTEXITCODE -ne 0) {
            throw "curl proxy request failed with code $LASTEXITCODE"
        }
    }
    finally {
        $env:NO_PROXY = $previousNoProxy
    }

    Start-Sleep -Seconds 2
}
finally {
    $proxyChildren = @(
        Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
            Where-Object { $_.ParentProcessId -eq $proxy.Id }
    )
    foreach ($proxyChild in $proxyChildren) {
        Stop-Process -Id $proxyChild.ProcessId -Force -ErrorAction SilentlyContinue
    }
    if (-not $proxy.HasExited) {
        Stop-Process -Id $proxy.Id -Force
    }
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id
    }
    Wait-Process -Id $proxy.Id, $server.Id -ErrorAction SilentlyContinue
}

$eventLines = @(
    Get-Content -Encoding UTF8 -LiteralPath $proxyOutput |
        Where-Object { $_.StartsWith("APPDBG_EVENT:") }
)

Write-Output "EVENT_COUNT=$($eventLines.Count)"
$eventLines

if ($eventLines.Count -lt 4) {
    throw "Expected at least four HTTP lifecycle events, got $($eventLines.Count)"
}

if (Test-Path -LiteralPath $proxyError) {
    $errors = Get-Content -Encoding UTF8 -LiteralPath $proxyError
    if ($errors) {
        Write-Output "MITMDUMP_STDERR:"
        $errors
    }
}
