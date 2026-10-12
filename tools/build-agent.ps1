$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$agentDir = Join-Path $projectRoot 'agent'
$binDir = Join-Path $projectRoot 'bin'
New-Item -ItemType Directory -Path $binDir -Force | Out-Null
$previousGOOS = $env:GOOS
$previousGOARCH = $env:GOARCH
$previousCGO = $env:CGO_ENABLED
try {
  $env:GOOS = 'linux'
  $env:CGO_ENABLED = '0'
  Push-Location $agentDir
  try {
    foreach ($architecture in @('amd64', 'arm64')) {
      $env:GOARCH = $architecture
      go build -trimpath '-ldflags=-s -w' -o (Join-Path $binDir "lightprobe-agent-linux-$architecture") .
      if ($LASTEXITCODE -ne 0) { throw "Build failed: $architecture" }
    }
  } finally { Pop-Location }
} finally {
  $env:GOOS = $previousGOOS
  $env:GOARCH = $previousGOARCH
  $env:CGO_ENABLED = $previousCGO
}
$hashLines = foreach ($architecture in @('amd64', 'arm64')) {
  $name = "lightprobe-agent-linux-$architecture"
  $hash = (Get-FileHash -LiteralPath (Join-Path $binDir $name) -Algorithm SHA256).Hash.ToLowerInvariant()
  "$hash  $name"
}
[IO.File]::WriteAllText((Join-Path $binDir 'SHA256SUMS'), ($hashLines -join "`n") + "`n", [Text.UTF8Encoding]::new($false))
$hashLines
