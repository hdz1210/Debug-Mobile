$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$smokeDirectory = Join-Path $projectRoot "runtime\app-ui-smoke"
New-Item -ItemType Directory -Force -Path $smokeDirectory | Out-Null
$smokeAppData = Join-Path $smokeDirectory "appdata"
$smokeLocalAppData = Join-Path $smokeDirectory "localappdata"
New-Item -ItemType Directory -Force -Path $smokeAppData, $smokeLocalAppData | Out-Null

$applicationPath = Join-Path $projectRoot "src-tauri\target\debug\app-network-debugger.exe"
$pythonPath = Join-Path $projectRoot ".venv\Scripts\python.exe"
$serverOutput = Join-Path $smokeDirectory "server.stdout.log"
$serverError = Join-Path $smokeDirectory "server.stderr.log"
$applicationOutput = Join-Path $smokeDirectory "application.stdout.log"
$applicationError = Join-Path $smokeDirectory "application.stderr.log"

if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
    throw "Build the debug application before running the Phase 2 UI smoke test."
}

$server = Start-Process `
    -FilePath $pythonPath `
    -ArgumentList @("-m", "http.server", "19081", "--bind", "127.0.0.1", "--directory", $projectRoot) `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $serverOutput `
    -RedirectStandardError $serverError `
    -PassThru `
    -WindowStyle Hidden

$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA
$env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=19333"
$env:APPDATA = $smokeAppData
$env:LOCALAPPDATA = $smokeLocalAppData

try {
    $application = Start-Process `
        -FilePath $applicationPath `
        -WorkingDirectory $projectRoot `
        -RedirectStandardOutput $applicationOutput `
        -RedirectStandardError $applicationError `
        -PassThru `
        -WindowStyle Hidden
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData

    try {
        node `
            (Join-Path $PSScriptRoot "cdp-ui-smoke.mjs") `
            "19333" `
            "8080" `
            "http://127.0.0.1:19081/README.md?source=ui-smoke"
        if ($LASTEXITCODE -ne 0) {
            throw "UI smoke test failed with exit code $LASTEXITCODE"
        }
    }
    finally {
        if (-not $application.HasExited) {
            $captureChildren = @(
                Get-CimInstance Win32_Process |
                    Where-Object {
                        $_.ParentProcessId -eq $application.Id -and
                        $_.CommandLine -like "*bridge.py*"
                    }
            )
            Stop-Process -Id $application.Id
            foreach ($captureChild in $captureChildren) {
                Stop-Process -Id $captureChild.ProcessId -ErrorAction SilentlyContinue
            }
        }
        Wait-Process -Id $application.Id -ErrorAction SilentlyContinue
    }
}
finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id
    }
    Wait-Process -Id $server.Id -ErrorAction SilentlyContinue
}
