param(
    [Parameter(Mandatory = $true)]
    [string]$PackageRoot
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$installRoot = [System.IO.Path]::GetFullPath($PackageRoot)
$applicationPath = Join-Path $installRoot "app-network-debugger.exe"
$expectedMitmdumpPath = Join-Path $installRoot "bin\mitmdump.exe"
$smokeRoot = Join-Path $projectRoot "runtime\package-ui-smoke"
$smokeAppData = Join-Path $smokeRoot "appdata"
$smokeLocalAppData = Join-Path $smokeRoot "localappdata"

if (-not (Test-Path -LiteralPath $applicationPath -PathType Leaf)) {
    throw "Packaged application was not found: $applicationPath"
}
if (-not (Test-Path -LiteralPath $expectedMitmdumpPath -PathType Leaf)) {
    throw "Packaged mitmdump was not found: $expectedMitmdumpPath"
}
if (Get-NetTCPConnection -LocalPort 8080 -State Listen -ErrorAction SilentlyContinue) {
    throw "Port 8080 is already in use."
}

New-Item -ItemType Directory -Force -Path $smokeRoot, $smokeAppData, $smokeLocalAppData |
    Out-Null

$pythonPath = (Get-Command python.exe).Source
$nodePath = (Get-Command node.exe).Source
$serverOutput = Join-Path $smokeRoot "server.stdout.log"
$serverError = Join-Path $smokeRoot "server.stderr.log"
$applicationOutput = Join-Path $smokeRoot "application.stdout.log"
$applicationError = Join-Path $smokeRoot "application.stderr.log"
$cdpOutput = Join-Path $smokeRoot "cdp.stdout.log"
$cdpError = Join-Path $smokeRoot "cdp.stderr.log"

$server = Start-Process `
    -FilePath $pythonPath `
    -ArgumentList @(
        "-m",
        "http.server",
        "19082",
        "--bind",
        "127.0.0.1",
        "--directory",
        $projectRoot
    ) `
    -WorkingDirectory $projectRoot `
    -RedirectStandardOutput $serverOutput `
    -RedirectStandardError $serverError `
    -PassThru `
    -WindowStyle Hidden

$previousBrowserArguments = $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS
$previousAppData = $env:APPDATA
$previousLocalAppData = $env:LOCALAPPDATA
$previousMitmdumpOverride = $env:APPDBG_MITMDUMP_PATH
$previousPath = $env:PATH
$application = $null
$cdp = $null

try {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=19344"
    $env:APPDATA = $smokeAppData
    $env:LOCALAPPDATA = $smokeLocalAppData
    Remove-Item Env:APPDBG_MITMDUMP_PATH -ErrorAction SilentlyContinue
    $env:PATH = "C:\Windows\System32;C:\Windows"

    $application = Start-Process `
        -FilePath $applicationPath `
        -WorkingDirectory $installRoot `
        -RedirectStandardOutput $applicationOutput `
        -RedirectStandardError $applicationError `
        -PassThru `
        -WindowStyle Hidden

    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:PATH = $previousPath
    if ($null -ne $previousMitmdumpOverride) {
        $env:APPDBG_MITMDUMP_PATH = $previousMitmdumpOverride
    }

    $cdp = Start-Process `
        -FilePath $nodePath `
        -ArgumentList @(
            (Join-Path $PSScriptRoot "cdp-ui-smoke.mjs"),
            "19344",
            "8080",
            "http://127.0.0.1:19082/README.md?source=ui-smoke"
        ) `
        -WorkingDirectory $projectRoot `
        -RedirectStandardOutput $cdpOutput `
        -RedirectStandardError $cdpError `
        -PassThru `
        -WindowStyle Hidden

    $observedMitmdump = $null
    $deadline = (Get-Date).AddSeconds(35)
    while ((Get-Date) -lt $deadline -and -not $cdp.HasExited -and $null -eq $observedMitmdump) {
        $observedMitmdump = Get-CimInstance `
            Win32_Process `
            -Filter "ParentProcessId = $($application.Id)" `
            -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -ieq "mitmdump.exe" } |
            Select-Object -First 1 ProcessId, ParentProcessId, ExecutablePath, CommandLine
        if ($null -eq $observedMitmdump) {
            Start-Sleep -Milliseconds 200
            $cdp.Refresh()
        }
    }

    if (-not $cdp.WaitForExit(45000)) {
        throw "Standalone UI smoke timed out."
    }
    $cdpResultText = Get-Content -Raw $cdpOutput -ErrorAction SilentlyContinue
    $cdpResult = try {
        $cdpResultText | ConvertFrom-Json
    }
    catch {
        $null
    }
    if (
        $null -eq $cdpResult -or
        -not $cdpResult.captureStarted -or
        -not $cdpResult.captureStopped -or
        -not $cdpResult.historyReloaded
    ) {
        $stderr = Get-Content -Raw $cdpError -ErrorAction SilentlyContinue
        throw "Standalone UI smoke failed: $stderr"
    }
    if ($null -eq $observedMitmdump) {
        throw "The packaged mitmdump child process was not observed."
    }

    $actualMitmdumpPath = [System.IO.Path]::GetFullPath($observedMitmdump.ExecutablePath)
    $expectedMitmdumpPath = [System.IO.Path]::GetFullPath($expectedMitmdumpPath)
    if (-not $actualMitmdumpPath.Equals(
        $expectedMitmdumpPath,
        [System.StringComparison]::OrdinalIgnoreCase
    )) {
        throw "Unexpected mitmdump path: $actualMitmdumpPath"
    }

    Write-Output "MITMDUMP_PATH=$actualMitmdumpPath"
    Write-Output "MITMDUMP_COMMAND=$($observedMitmdump.CommandLine)"
    Write-Output $cdpResultText
}
finally {
    $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = $previousBrowserArguments
    $env:APPDATA = $previousAppData
    $env:LOCALAPPDATA = $previousLocalAppData
    $env:PATH = $previousPath
    if ($null -ne $previousMitmdumpOverride) {
        $env:APPDBG_MITMDUMP_PATH = $previousMitmdumpOverride
    }
    else {
        Remove-Item Env:APPDBG_MITMDUMP_PATH -ErrorAction SilentlyContinue
    }

    if ($null -ne $cdp -and -not $cdp.HasExited) {
        Stop-Process -Id $cdp.Id -Force -ErrorAction SilentlyContinue
    }
    if ($null -ne $application -and -not $application.HasExited) {
        $captureChildren = Get-CimInstance `
            Win32_Process `
            -Filter "ParentProcessId = $($application.Id)" `
            -ErrorAction SilentlyContinue
        Stop-Process -Id $application.Id -Force -ErrorAction SilentlyContinue
        foreach ($captureChild in $captureChildren) {
            Stop-Process -Id $captureChild.ProcessId -Force -ErrorAction SilentlyContinue
        }
    }
    Get-Process mitmdump -ErrorAction SilentlyContinue |
        Where-Object {
            $_.Path -and
            [System.IO.Path]::GetFullPath($_.Path).Equals(
                [System.IO.Path]::GetFullPath($expectedMitmdumpPath),
                [System.StringComparison]::OrdinalIgnoreCase
            )
        } |
        Stop-Process -Force -ErrorAction SilentlyContinue
    if (-not $server.HasExited) {
        Stop-Process -Id $server.Id -Force -ErrorAction SilentlyContinue
    }
}
