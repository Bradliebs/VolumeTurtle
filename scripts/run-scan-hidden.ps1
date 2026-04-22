Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")
& (Join-Path $PSScriptRoot "run-scan.bat")
exit $LASTEXITCODE
