$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$smokeDirectory = Join-Path $projectRoot "runtime\forced-exit-smoke"
$applicationPath = Join-Path $projectRoot "src-tauri\target\release\app-network-debugger.exe"
$cdpScript = Join-Path $PSScriptRoot "cdp-ui-smoke.mjs"
$expectedVersion = (Get-Content -Raw (Join-Path $projectRoot "package.json") |
    ConvertFrom-Json).version

if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8080 is busy before the forced-exit smoke test."
}
if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
    throw "Build the release application before running the forced-exit smoke test."
}

New-Item -ItemType Directory -Force -Path $smokeDirectory | Out-Null

$pythonPath = (Get-Command python.exe).Source
$nodePath = (Get-Command node.exe).Source
$server = Start-Process `
    -FilePath $pythonPath `
    -ArgumentList @(
        "-m",
        "http.server",
        "19083",
        "--bind",
        "127.0.0.1",
        "--directory",
        $projectRoot
    ) `
    -RedirectStandardOutput (Join-Path $smokeDirectory "server.stdout.log") `
    -RedirectStandardError (Join-Path $smokeDirectory "server.stderr.log") `
    -PassThru `
    -WindowStyle Hidden

$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$application = $null
$cdp = $null
$proxyPid = $null
$diagnosticLogPath = $null

try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=19346"
    $application = Start-Process `
        -FilePath $applicationPath `
        -WorkingDirectory $projectRoot `
        -PassThru `
        -WindowStyle Hidden
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments

    $cdp = Start-Process `
        -FilePath $nodePath `
        -ArgumentList @(
            $cdpScript,
            "19346",
            "8080",
            "http://127.0.0.1:19083/README.md?source=ui-smoke",
            "start-only"
        ) `
        -WorkingDirectory $projectRoot `
        -RedirectStandardOutput (Join-Path $smokeDirectory "cdp.stdout.log") `
        -RedirectStandardError (Join-Path $smokeDirectory "cdp.stderr.log") `
        -PassThru `
        -WindowStyle Hidden

    $deadline = (Get-Date).AddSeconds(30)
    while ((Get-Date) -lt $deadline -and $null -eq $proxyPid) {
        $listener = Get-NetTCPConnection `
            -LocalPort 8080 `
            -State Listen `
            -ErrorAction SilentlyContinue |
            Select-Object -First 1
        if ($listener) {
            $owner = Get-CimInstance `
                Win32_Process `
                -Filter "ProcessId = $($listener.OwningProcess)"
            $ancestorProcessId = $owner.ParentProcessId
            $applicationIsAncestor = $false
            for (
                $depth = 0;
                $depth -lt 8 -and $ancestorProcessId -gt 0;
                $depth++
            ) {
                if ($ancestorProcessId -eq $application.Id) {
                    $applicationIsAncestor = $true
                    break
                }

                $ancestor = Get-CimInstance `
                    Win32_Process `
                    -Filter "ProcessId = $ancestorProcessId" `
                    -ErrorAction SilentlyContinue
                if ($null -eq $ancestor) {
                    break
                }
                $ancestorProcessId = $ancestor.ParentProcessId
            }
            if (-not $applicationIsAncestor) {
                throw "Port 8080 owner PID $($owner.ProcessId) does not belong to app PID $($application.Id)."
            }
            $proxyPid = $owner.ProcessId
            $proxyPath = $owner.ExecutablePath
        }
        else {
            Start-Sleep -Milliseconds 100
        }
    }
    if ($null -eq $proxyPid) {
        throw "Capture did not start in time."
    }
    if (-not $cdp.WaitForExit(5000)) {
        throw "The diagnostic capture setup did not finish in time."
    }
    $cdpResult = Get-Content `
        -Raw `
        -LiteralPath (Join-Path $smokeDirectory "cdp.stdout.log") |
        ConvertFrom-Json
    $diagnosticLogPath = $cdpResult.diagnosticLog.filePath
    if (
        -not $diagnosticLogPath -or
        -not (Test-Path -LiteralPath $diagnosticLogPath -PathType Leaf)
    ) {
        throw "The diagnostic log was not created."
    }

    Stop-Process -Id $application.Id -Force
    Wait-Process -Id $application.Id -ErrorAction SilentlyContinue

    $exitDeadline = (Get-Date).AddSeconds(5)
    while (
        (Get-Date) -lt $exitDeadline -and
        (Get-Process -Id $proxyPid -ErrorAction SilentlyContinue)
    ) {
        Start-Sleep -Milliseconds 100
    }

    if (Get-Process -Id $proxyPid -ErrorAction SilentlyContinue) {
        throw "Proxy PID $proxyPid survived application termination."
    }
    if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
        throw "Port 8080 remained occupied after application termination."
    }
    $diagnosticText = Get-Content -Raw -LiteralPath $diagnosticLogPath
    if (
        -not $diagnosticText.Contains(
            "Session started; version=$expectedVersion; pid=$($application.Id)"
        ) -or
        -not $diagnosticText.Contains("Capture is running; pid=")
    ) {
        throw "The diagnostic log is missing application or capture lifecycle entries."
    }

    Write-Output "FORCED_EXIT_CLEANUP=PASS"
    Write-Output "DIAGNOSTIC_LOG=PASS"
    Write-Output "DIAGNOSTIC_LOG_PATH=$diagnosticLogPath"
    Write-Output "APP_PID=$($application.Id)"
    Write-Output "PROXY_PID=$proxyPid"
    Write-Output "PROXY_PATH=$proxyPath"
}
finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    if ($null -ne $cdp -and -not $cdp.HasExited) {
        Stop-Process -Id $cdp.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $application -and -not $application.HasExited) {
        Stop-Process -Id $application.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $proxyPid -and (Get-Process -Id $proxyPid -ErrorAction SilentlyContinue)) {
        Stop-Process -Id $proxyPid -Force -ErrorAction SilentlyContinue
    }
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
