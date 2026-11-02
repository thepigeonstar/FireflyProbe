param(
  [Parameter(Mandatory=$true)][string]$TargetIP,
  [string]$PortList = '1443,11443',
  [string]$RemoteHost = '',
  [string]$RemoteUser = 'root',
  [ValidateRange(1,65535)][int]$SSHPort = 22,
  [ValidateRange(1,3)][int]$Attempts = 3,
  [ValidateRange(1,5)][int]$TimeoutSeconds = 3,
  [string]$OutputFile = ''
)
$ErrorActionPreference = 'Stop'
$parsedAddress = $null
if (![Net.IPAddress]::TryParse($TargetIP,[ref]$parsedAddress)) {throw '目标请填写 IP 地址，不填写网址或端口。'}
$TargetIP = $parsedAddress.ToString()
if ($PortList -notmatch '^\s*\d{1,5}\s*(,\s*\d{1,5}\s*){0,7}$') {throw '端口请用逗号分隔，例如 1443,11443。'}
$Ports = @($PortList.Split(',') | ForEach-Object {[int]$_.Trim()})
if (!$Ports.Count -or $Ports.Count -gt 8 -or ($Ports | Where-Object {$_ -lt 1 -or $_ -gt 65535})) {throw '请提供 1–8 个端口，每个端口为 1–65535。'}
$Ports = @($Ports | Select-Object -Unique)
if ($RemoteHost -and ($RemoteHost -notmatch '^[a-zA-Z0-9.:_-]{1,253}$' -or $RemoteHost.StartsWith('-'))) {throw '远端主机请填写 IP 或域名。'}
if ($RemoteUser -notmatch '^[a-zA-Z0-9_][a-zA-Z0-9_.-]{0,31}$') {throw 'SSH 用户名无效。'}
if ($RemoteHost -and !(Get-Command ssh -ErrorAction SilentlyContinue)) {throw '未找到 Windows OpenSSH 客户端，请先安装或仅做本机测试。'}
if (!$OutputFile) {$OutputFile = Join-Path (Get-Location) ('Firefly-network-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')}
$reportPath = [IO.Path]::GetFullPath($OutputFile)

function Test-LocalTCP([int]$Port) {
  $samples = @()
  for ($attempt=0; $attempt -lt $Attempts; $attempt++) {
    $client = [Net.Sockets.TcpClient]::new($parsedAddress.AddressFamily)
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $status = 'error'
    try {
      $task = $client.ConnectAsync($parsedAddress,$Port)
      if (!$task.Wait($TimeoutSeconds*1000)) {$status='timeout'}
      elseif ($client.Connected) {$status='success'}
    } catch {
      $cause = $_.Exception
      while ($cause.InnerException) {$cause=$cause.InnerException}
      if ($cause -is [Net.Sockets.SocketException]) {
        $status = switch ($cause.SocketErrorCode.ToString()) {
          'ConnectionRefused' {'refused'}
          'TimedOut' {'timeout'}
          'NetworkUnreachable' {'unreachable'}
          'HostUnreachable' {'unreachable'}
          default {'error'}
        }
      }
    } finally {$watch.Stop();$client.Dispose()}
    $samples += [pscustomobject]@{status=$status;ms=[math]::Round($watch.Elapsed.TotalMilliseconds,1)}
  }
  return [pscustomobject]@{port=$Port;samples=$samples}
}
function Get-PortState($Row) {
  if (!$Row) {return 'unknown'}
  $samples = @($Row.samples)
  if (!$samples.Count) {return 'unknown'}
  $ok = @($samples | Where-Object {$_.status -eq 'success'}).Count
  if ($ok -eq $samples.Count) {return 'reachable'}
  if ($ok) {return 'unstable'}
  if (@($samples | Where-Object {$_.status -eq 'timeout'}).Count -eq $samples.Count) {return 'timeout'}
  if (@($samples | Where-Object {$_.status -eq 'refused'}).Count -eq $samples.Count) {return 'refused'}
  return 'failed'
}
$labels = @{reachable='可连接';unstable='部分成功';timeout='全部超时';refused='连接被拒绝';failed='连接失败';unknown='未完成'}
Write-Host '萤火 TCP 快速诊断：仅建立短暂连接，不发送业务数据，不修改服务器配置。'
Write-Host '请先关闭 Clash 的 TUN 并退出代理，确认本机当前网络。测点所在地由你确认。'
Write-Host '仅测试你已确认正在监听的端口；未开放端口的超时不能用来判断阻断。'
$started = [DateTime]::UtcNow.ToString('o')
$localRows = @()
foreach ($port in $Ports) {
  $row=Test-LocalTCP $port
  $localRows += $row
  Write-Host ("本机 -> {0}:{1}：{2}" -f $TargetIP,$port,$labels[(Get-PortState $row)])
}
$remoteRows=@();$remoteError=''
if ($RemoteHost) {
  Write-Host '正在通过 SSH 请求远端测试相同端口。首次连接可能要求确认主机指纹或输入 SSH 密码。'
  $payload=@{target=$TargetIP;ports=$Ports;attempts=$Attempts;timeout=$TimeoutSeconds} | ConvertTo-Json -Compress
  $body=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($payload))
  $python=@'
import base64, concurrent.futures, datetime, ipaddress, json, socket, errno
cfg=json.loads(base64.b64decode('PAYLOAD'))
target=str(ipaddress.ip_address(cfg['target']))
def probe(port):
    samples=[]
    import time
    for _ in range(cfg['attempts']):
        at=time.monotonic();status='error'
        try:
            with socket.create_connection((target,port),timeout=cfg['timeout']):status='success'
        except (socket.timeout,TimeoutError):status='timeout'
        except ConnectionRefusedError:status='refused'
        except OSError as exc:
            status='unreachable' if exc.errno in (errno.ENETUNREACH,errno.EHOSTUNREACH) else 'error'
        samples.append(dict(status=status,ms=round((time.monotonic()-at)*1000,1)))
    return dict(port=port,samples=samples)
started=datetime.datetime.now(datetime.timezone.utc).isoformat()
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:rows=list(pool.map(probe,cfg['ports']))
print('FIREFLY_NETWORK '+json.dumps(dict(target=target,started=started,rows=rows)),flush=True)
'@
  $python=$python.Replace('PAYLOAD',$body)
  $source=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($python))
  $command="python3 -c 'import base64;exec(compile(base64.b64decode(`"$source`"),`"firefly-network`",`"exec`"))'"
  $sshArgs=@('-p',[string]$SSHPort,'-o','ConnectTimeout=10','-o','ServerAliveInterval=5','-o','ServerAliveCountMax=2','-l',$RemoteUser,$RemoteHost,$command)
  try {
    $stdout = @(& ssh @sshArgs)
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {throw '远端 SSH 或 Python 检测失败'}
    $lines=@($stdout | Where-Object {$_ -like 'FIREFLY_NETWORK *'})
    if ($lines.Count -ne 1) {throw '未收到有效远端结果'}
    $remoteResult=$lines[0].Substring(16) | ConvertFrom-Json
    if ($remoteResult.target -ne $TargetIP) {throw '远端检测目标不一致'}
    foreach ($port in $Ports) {
      $rows=@($remoteResult.rows | Where-Object {$_.port -eq $port})
      if ($rows.Count -ne 1 -or @($rows[0].samples).Count -ne $Attempts) {throw '远端检测结果不完整'}
      if (@($rows[0].samples | Where-Object {$_.status -notin @('success','timeout','refused','unreachable','error')}).Count) {throw '远端计数无效'}
    }
    $remoteRows=@($remoteResult.rows)
  } catch {$remoteError='远端检测未完成：'+$_.Exception.Message;Write-Host $remoteError}
}
$comparison=@()
foreach ($port in $Ports) {
  $localState=Get-PortState ($localRows | Where-Object {$_.port -eq $port})
  $remoteState=Get-PortState ($remoteRows | Where-Object {$_.port -eq $port})
  $comparison += [pscustomobject]@{port=$port;local=$localState;remote=$remoteState}
}
Write-Host ''
foreach ($row in $comparison) {Write-Host ("端口 {0}：本机 {1}；远端 {2}" -f $row.port,$labels[$row.local],$labels[$row.remote])}
$differential=@($comparison | Where-Object {$_.remote -eq 'reachable' -and $_.local -eq 'timeout'})
$message='仅本机结果：可判断当前网络到指定端口的连接情况，无法判断国内 / 国外差异。'
if ($RemoteHost -and !$remoteError) {
  if ($differential.Count -eq $Ports.Count) {$message='所有受测端口在远端可达、本机全部超时：疑似来源网络相关的 TCP 访问受限。若本机为大陆网络、远端为境外，则符合国内到目标 TCP 访问受限的表现。'}
  elseif ($differential.Count) {$message='部分端口在远端可达、本机超时：存在端口 / 路径相关差异，请核对防火墙和访问策略。'}
  elseif (@($comparison | Where-Object {$_.local -eq 'reachable' -and $_.remote -eq 'reachable'}).Count -eq $Ports.Count) {$message='两端全部连接成功：本轮 TCP 可达；若业务仍失败，继续查转发目标与客户端协议。'}
  elseif (@($comparison | Where-Object {$_.local -eq 'unstable' -or $_.remote -eq 'unstable'}).Count) {$message='有端口仅部分尝试成功：连接不稳定，需要多时段、更多测点复核。'}
  else {$message='未形成稳定的单向对照结果：请先核对服务监听、测点网络与防火墙，不能据此判断阻断。'}
} elseif ($remoteError) {$message=$remoteError+'；不会把 SSH 或测点故障判为目标被阻断。'}
Write-Host $message
Write-Host '结论只覆盖本次来源、时间和受测端口；不能证明所有 65535 个端口被阻断，也不能确定由 GFW 导致。'
Write-Host '建议再用 ITDOG 国内三网及海外多点交叉验证：https://www.itdog.cn/tcping/'
$report=[ordered]@{format=1;target=$TargetIP;started=$started;finished=[DateTime]::UtcNow.ToString('o');ports=$Ports;attempts=$Attempts;local=@{label='当前电脑网络';rows=$localRows};remote=@{host=$RemoteHost;rows=$remoteRows;error=$remoteError};comparison=$comparison;summary=$message}
[IO.File]::WriteAllText($reportPath,($report | ConvertTo-Json -Depth 10),[Text.UTF8Encoding]::new($false))
Write-Host ('报告已保存：'+$reportPath)
