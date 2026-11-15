$ErrorActionPreference = 'Stop'
$opsNode = Join-Path $PSScriptRoot '../runtime/node.exe'
if (-not (Test-Path -LiteralPath $opsNode -PathType Leaf)) { $opsNode = 'node.exe' }
& $opsNode (Join-Path $PSScriptRoot 'ops.mjs') @args
exit $LASTEXITCODE
