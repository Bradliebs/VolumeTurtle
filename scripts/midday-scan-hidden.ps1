Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")
& (Join-Path $PSScriptRoot "midday-scan.bat")
exit $LASTEXITCODE
