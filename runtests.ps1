<#
.SYNOPSIS
    Lint, then the browser's tests in headless Chrome or Edge.

.DESCRIPTION
    1. Lint of the Python parts (server\, tools\, tests\*.py): ruff check .
       (ruff.toml), when ruff is installed; the JavaScript has no linter
       (no Node.js, see EN-8 in IMPROVEMENTS.md).
    2. python -B tests\run_tests.py: the unit and smoke tests, against the
       real ArchiMate API from the folder next to this one (..\ArchiMateAPI).

    The API's runtests.ps1 -WithClients runs this script too, so that a change
    of the API is tested against the browser.

.PARAMETER Filter
    Only the tests whose "suite > name" contains this text.

.EXAMPLE
    .\runtests.ps1
#>
[CmdletBinding()]
param(
    [string]$Filter = ""
)

Set-Location $PSScriptRoot

Write-Host "=== Lint (ruff) ===" -ForegroundColor Cyan
python -m ruff --version *> $null
if ($LASTEXITCODE -ne 0) {
    Write-Host "ruff is not installed (pip install ruff); lint skipped." -ForegroundColor Yellow
} else {
    python -m ruff check .
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED: ruff found problems." -ForegroundColor Red; exit 1 }
}

Write-Host "=== Tests ===" -ForegroundColor Cyan
$runArgs = @("-B", "tests\run_tests.py")
if ($Filter) { $runArgs += @("--filter", $Filter) }
python @runArgs
if ($LASTEXITCODE -ne 0) {
    Write-Host "FAILED: run_tests.py exit code $LASTEXITCODE (1: failures, 2: the tests could not run)." -ForegroundColor Red
    exit 1
}
Write-Host "All tests passed." -ForegroundColor Green
exit 0
