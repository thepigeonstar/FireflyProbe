param([string]$Proxy = '', [string]$SourceDir = '')
$ErrorActionPreference = 'Stop'
if ($Proxy -and $Proxy -notmatch '^(https?|socks5h?)://(127\.0\.0\.1|localhost|\[::1\]):[0-9]{1,5}/?$') { throw '代理请填写本地地址，例如 http://127.0.0.1:6348' }
if ($Proxy -and (([Uri]$Proxy).Port -lt 1 -or ([Uri]$Proxy).Port -gt 65535)) { throw '代理端口无效。' }
if (!$SourceDir) { $SourceDir = Join-Path (Split-Path $PSScriptRoot -Parent) 'docs\wiki' }
$wikiSource = (Resolve-Path -LiteralPath $SourceDir).Path
if (!(Test-Path -LiteralPath (Join-Path $wikiSource 'Plugin-Development.md'))) { throw '缺少插件开发文档，请使用最新发布包。' }
function Invoke-WikiGit {
  param([string[]]$GitArgs)
  $commandArgs = if ($Proxy) { @('-c',"http.proxy=$Proxy") + $GitArgs } else { $GitArgs }
  & git @commandArgs
  if ($LASTEXITCODE -ne 0) { throw 'Wiki Git 操作失败。首次请在 GitHub Wiki 创建并保存首页，再重试；同时检查网络与 GitHub 登录。' }
}
$wikiTarget = Join-Path ([IO.Path]::GetTempPath()) ('FireflyProbe-wiki-' + [guid]::NewGuid().ToString('N'))
Invoke-WikiGit -GitArgs @('-c','http.sslBackend=schannel','clone','https://github.com/thepigeonstar/FireflyProbe.wiki.git',$wikiTarget)
Get-ChildItem -LiteralPath $wikiSource -Filter '*.md' -File | ForEach-Object { Copy-Item -LiteralPath $_.FullName -Destination $wikiTarget -Force }
Invoke-WikiGit -GitArgs @('-C',$wikiTarget,'config','user.name','thepigeonstar')
Invoke-WikiGit -GitArgs @('-C',$wikiTarget,'config','user.email','thepigeonstar@users.noreply.github.com')
Invoke-WikiGit -GitArgs @('-C',$wikiTarget,'add','Home.md','Plugin-Development.md','_Sidebar.md')
& git -C $wikiTarget diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Write-Host 'Wiki 已是最新文档。'; exit 0 }
if ($LASTEXITCODE -ne 1) { throw '无法检查 Wiki 改动。' }
Invoke-WikiGit -GitArgs @('-C',$wikiTarget,'commit','-m','Document Firefly Probe plugin development')
Invoke-WikiGit -GitArgs @('-C',$wikiTarget,'push','origin','HEAD')
Write-Host 'Wiki 文档已发布：https://github.com/thepigeonstar/FireflyProbe/wiki'
