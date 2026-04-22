Set-Location -LiteralPath (Join-Path $PSScriptRoot "..")
& (Join-Path $PSScriptRoot "cruise-daemon.bat")
exit $LASTEXITCODE
