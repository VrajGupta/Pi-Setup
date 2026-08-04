$ErrorActionPreference = "Stop"
$root = $PSScriptRoot
& node (Join-Path $root "scripts/install.mjs") @args
exit $LASTEXITCODE
