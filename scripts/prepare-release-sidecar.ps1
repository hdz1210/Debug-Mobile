$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$requirementsPath = Join-Path $projectRoot "requirements-release.txt"
$entryPointPath = Join-Path $projectRoot "src-tauri\sidecar\mitmdump_entry.py"
$releaseBuildDirectory = Join-Path $projectRoot "runtime\release-build"
$releaseEnvironment = Join-Path $releaseBuildDirectory "venv"
$releasePython = Join-Path $releaseEnvironment "Scripts\python.exe"
$releasePyInstaller = Join-Path $releaseEnvironment "Scripts\pyinstaller.exe"
$resourceDirectory = Join-Path $projectRoot "src-tauri\release-resources"
$mitmdumpPath = Join-Path $resourceDirectory "mitmdump.exe"
$recipeMarker = Join-Path $releaseBuildDirectory "sidecar.recipe.sha256"

$recipeInput = @(
    (Get-FileHash -LiteralPath $requirementsPath -Algorithm SHA256).Hash,
    (Get-FileHash -LiteralPath $entryPointPath -Algorithm SHA256).Hash
) -join "`n"
$recipeBytes = [System.Text.Encoding]::UTF8.GetBytes($recipeInput)
$sha256 = [System.Security.Cryptography.SHA256]::Create()
try {
    $recipeHash = -join (
        $sha256.ComputeHash($recipeBytes) |
            ForEach-Object { $_.ToString("x2") }
    )
}
finally {
    $sha256.Dispose()
}
$previousRecipe = if (Test-Path -LiteralPath $recipeMarker) {
    (Get-Content -Raw -LiteralPath $recipeMarker).Trim()
}
else {
    ""
}

if (
    $previousRecipe -eq $recipeHash -and
    (Test-Path -LiteralPath $mitmdumpPath -PathType Leaf)
) {
    $metadata = Get-Item -LiteralPath $mitmdumpPath
    Write-Host "Prepared cached restricted mitmdump sidecar ($($metadata.Length) bytes)."
    exit 0
}

New-Item -ItemType Directory -Force -Path $releaseBuildDirectory, $resourceDirectory |
    Out-Null

if (-not (Test-Path -LiteralPath $releasePython -PathType Leaf)) {
    $bootstrapPython = (Get-Command python.exe -ErrorAction Stop).Source
    & $bootstrapPython -m venv $releaseEnvironment
    if ($LASTEXITCODE -ne 0) {
        throw "Cannot create the release sidecar Python environment."
    }
}

& $releasePython -m pip install `
    --disable-pip-version-check `
    --requirement $requirementsPath
if ($LASTEXITCODE -ne 0) {
    throw "Cannot install the pinned release sidecar dependencies."
}

& $releasePyInstaller `
    --noconfirm `
    --clean `
    --onefile `
    --console `
    --name mitmdump `
    --exclude-module pydivert `
    --exclude-module mitmproxy_windows `
    --distpath $resourceDirectory `
    --workpath (Join-Path $releaseBuildDirectory "pyinstaller") `
    --specpath $releaseBuildDirectory `
    $entryPointPath
if ($LASTEXITCODE -ne 0) {
    throw "Cannot build the restricted mitmdump sidecar."
}

if (-not (Test-Path -LiteralPath $mitmdumpPath -PathType Leaf)) {
    throw "The restricted mitmdump sidecar was not produced."
}

[System.IO.File]::WriteAllText(
    $recipeMarker,
    $recipeHash,
    [System.Text.UTF8Encoding]::new($false)
)

$metadata = Get-Item -LiteralPath $mitmdumpPath
Write-Host "Prepared restricted mitmdump 12.2.3 sidecar ($($metadata.Length) bytes)."
