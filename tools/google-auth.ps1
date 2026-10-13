param([string]$Proxy = '')
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
if (![Environment]::Is64BitOperatingSystem) { throw '此授权助手需要 64 位 Windows。' }
$authCacheDirectory = Join-Path $env:LOCALAPPDATA 'FireflyProbe\GoogleAuth'
New-Item -ItemType Directory -Path $authCacheDirectory -Force | Out-Null
$authArchivePath = Join-Path $authCacheDirectory ('rclone-' + [guid]::NewGuid().ToString('N') + '.zip')
Write-Host '正在下载并校验官方 rclone，完成后会打开 Google 授权页面。'
$authWebOptions = @{ UseBasicParsing=$true }
if (!$Proxy) {
  $authProbeUri = [Uri]'https://oauth2.googleapis.com/token'
  $authSystemProxy = [Net.WebRequest]::DefaultWebProxy.GetProxy($authProbeUri)
  if ($authSystemProxy -and $authSystemProxy.AbsoluteUri -ne $authProbeUri.AbsoluteUri -and $authSystemProxy.Host -in @('127.0.0.1','localhost','::1')) { $Proxy=$authSystemProxy.AbsoluteUri }
}
if ($Proxy) {
  if ($Proxy -notmatch '^https?://(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}/?$' -or ([Uri]$Proxy).Port -lt 1 -or ([Uri]$Proxy).Port -gt 65535) { throw '本地代理格式无效，例如 http://127.0.0.1:6348' }
  $authWebOptions.Proxy=$Proxy
  Write-Host '将使用本地代理下载并完成授权。'
}
Invoke-WebRequest @authWebOptions -Uri 'https://downloads.rclone.org/rclone-current-windows-amd64.zip' -OutFile $authArchivePath
Add-Type -AssemblyName System.IO.Compression.FileSystem
$authArchive = [IO.Compression.ZipFile]::OpenRead($authArchivePath)
try {
  $authExecutables = @($authArchive.Entries | Where-Object { $_.FullName -match '^rclone-v[0-9]+\.[0-9]+\.[0-9]+-windows-amd64/rclone\.exe$' })
  if ($authExecutables.Count -ne 1) { throw '下载文件结构无效。' }
  $authReleaseFolder = $authExecutables[0].FullName.Split('/')[0]
  $authReleaseVersion = $authReleaseFolder -replace '^rclone-(v[0-9]+\.[0-9]+\.[0-9]+)-windows-amd64$', '$1'
  $authChecksumText = (Invoke-WebRequest @authWebOptions -Uri "https://downloads.rclone.org/$authReleaseVersion/SHA256SUMS").Content
  if ($authChecksumText -is [byte[]]) { $authChecksumText=[Text.Encoding]::UTF8.GetString($authChecksumText) }
  $authChecksumPattern = '(?m)^([a-fA-F0-9]{64})\s+\*?' + [Regex]::Escape($authReleaseFolder + '.zip') + '\s*$'
  $authChecksumMatch = [Regex]::Match([string]$authChecksumText, $authChecksumPattern)
  if (!$authChecksumMatch.Success -or (Get-FileHash -LiteralPath $authArchivePath -Algorithm SHA256).Hash -ne $authChecksumMatch.Groups[1].Value) { throw 'rclone 校验失败，未运行下载的程序。' }
  $authRclonePath = Join-Path $authCacheDirectory ($authReleaseFolder + '.exe')
  [IO.Compression.ZipFileExtensions]::ExtractToFile($authExecutables[0], $authRclonePath, $true)
} finally { $authArchive.Dispose(); Remove-Item -LiteralPath $authArchivePath -Force }
# Begin interactive authorization
Write-Host '请在打开的浏览器中选择 Google 账号并授权。授权结果不会保存为明文文件。'
# Capture stdout and stderr; never print account tokens into the console.
$authOldErrorPreference = $ErrorActionPreference
$ErrorActionPreference = 'Continue'
$authPreviousHttpsProxy=[Environment]::GetEnvironmentVariable('HTTPS_PROXY','Process')
$authorizationLines=[Collections.Generic.List[string]]::new()
try {
  if ($Proxy) { [Environment]::SetEnvironmentVariable('HTTPS_PROXY',$Proxy,'Process') }
  & $authRclonePath authorize drive --drive-scope drive.file 2>&1 | ForEach-Object {
    $authLine=[string]$_
    $authorizationLines.Add($authLine)
    $authUrlMatch=[Regex]::Match($authLine,'http://127\.0\.0\.1:53682/auth[^\s"<>]*')
    if ($authUrlMatch.Success) { Write-Host ('如果浏览器未打开，可打开此本地链接：'+$authUrlMatch.Value) }
  }
  $authorizationExitCode=$LASTEXITCODE
} finally {
  $ErrorActionPreference=$authOldErrorPreference
  [Environment]::SetEnvironmentVariable('HTTPS_PROXY',$authPreviousHttpsProxy,'Process')
}
$authorizationOutput=$authorizationLines -join "`n"
if ($authorizationExitCode -ne 0) { throw 'Google 授权未完成，请检查网络或重新运行。' }
$authorizationMatch = [Regex]::Match($authorizationOutput, '\{\s*"access_token"[\s\S]*?\}')
if (!$authorizationMatch.Success) { throw '未取得授权结果，请使用文档中的 rclone 配置方式。' }
$authorizationToken = $authorizationMatch.Value | ConvertFrom-Json
if (!$authorizationToken.access_token -or !$authorizationToken.refresh_token) { throw '授权缺少刷新 Token，请重新授权。' }
$authorizationJson = $authorizationToken | ConvertTo-Json -Compress
Set-Clipboard -Value $authorizationJson
Write-Host '授权结果已复制到剪贴板。回到 Firefly 后台，粘贴到“授权结果”并保存。'
Write-Host '不要把授权结果发送到聊天或公开分享；导入后清空剪贴板。'
