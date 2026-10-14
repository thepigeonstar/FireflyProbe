import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {sshFields} from './ssh.mjs';
import {dayKey} from './store.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const quote=s=>"'"+String(s).replaceAll("'","'\\''")+"'";
export const gostVersion='3.3.0';
export const gostHashes={amd64:'676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5',arm64:'d03699e3f385d4ff5dad68046712adfcc7515325a064d2ab046e0bece30f8f8f'};
export function forwardingFields(input){
 if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'转发规则格式无效');
 if(!['tcp','udp','both'].includes(input.protocol))fail(400,'请选择 TCP、UDP 或 TCP + UDP');
 for(const k of ['listen_port','target_port'])if(!Number.isInteger(input[k])||input[k]<1||input[k]>65535)fail(400,'端口需为 1–65535 的整数');
 const host=sshFields({ssh_host:input.target_host}).ssh_host;if(!host)fail(400,'请填写目标 IP 或域名');
 if(input.target_port===input.listen_port&&(host==='localhost'||host==='::1'||/^127\./.test(host)))fail(400,'本机目标端口不能与监听端口相同，避免循环转发');
 const name=input.name??'';if(typeof name!=='string'||name.length>80)fail(400,'规则名称最多 80 个字符');
 return {name,protocol:input.protocol,listen_port:input.listen_port,target_host:host,target_port:input.target_port};
}
export function forwardURLs(rule){const host=isIP(rule.target_host)===6?'['+rule.target_host+']':rule.target_host;return (rule.protocol==='both'?['tcp','udp']:[rule.protocol]).map(p=>`${p}://:${rule.listen_port}/${host}:${rule.target_port}`);}
export function forwardScript(rule,action){
 if(!/^[a-f0-9-]{36}$/.test(rule.id)||!['start','stop','status','remove'].includes(action))fail(400,'转发操作无效');
 const unit='firefly-forward-'+rule.id,urls=forwardURLs(forwardingFields(rule));
 const pre=`#!/bin/sh\nset -eu\numask 077\nexport PYTHONUTF8=1 PYTHONIOENCODING=utf-8\n[ "$(id -u)" = 0 ] || { echo '需要 root 或免密 sudo'; exit 1; }\nunit=${quote(unit)}\nif command -v systemctl >/dev/null; then manager=systemd; elif [ -x /sbin/openrc-run ]; then manager=openrc; else echo '需要 systemd 或 OpenRC'; exit 1; fi\n`;
 const status=`if [ "$manager" = systemd ]; then if systemctl is-active --quiet "$unit"; then echo FIREFLY_FORWARD_ACTIVE; else echo FIREFLY_FORWARD_STOPPED; fi; else if rc-service "$unit" status >/dev/null 2>&1; then echo FIREFLY_FORWARD_ACTIVE; else echo FIREFLY_FORWARD_STOPPED; fi; fi\n`;
 if(action==='status')return pre+status;
 const stop=`if [ "$manager" = systemd ]; then if [ -f "/etc/systemd/system/$unit.service" ]; then systemctl disable --now "$unit"; fi; else if [ -f "/etc/init.d/$unit" ]; then if rc-service "$unit" status >/dev/null 2>&1; then rc-service "$unit" stop; fi; rc-update del "$unit" default >/dev/null 2>&1 || true; fi; fi\n`;
 if(action==='stop')return pre+stop+'echo FIREFLY_FORWARD_STOPPED\n';
 if(action==='remove')return pre+stop+`rm -f "/etc/systemd/system/$unit.service" "/etc/init.d/$unit" "/opt/firefly-forward/run-${rule.id}.sh" "/etc/firefly-forward/${rule.id}.json"\nif [ "$manager" = systemd ]; then systemctl daemon-reload; fi\necho FIREFLY_FORWARD_REMOVED\n`;
 return pre+`command -v curl >/dev/null && command -v python3 >/dev/null || { echo '请先安装萤火采集端，准备 curl 和 Python'; exit 1; }
case "$(uname -m)" in x86_64) arch=amd64; expected=${gostHashes.amd64} ;; aarch64|arm64) arch=arm64; expected=${gostHashes.arm64} ;; *) echo '仅支持 amd64 / arm64'; exit 1 ;; esac
install -d -m 0755 /opt/firefly-forward
if [ ! -x /opt/firefly-forward/gost-${gostVersion} ]; then
 temporary=$(mktemp -d)
 trap 'rm -rf -- "$temporary"' EXIT
 archive="gost_${gostVersion}_linux_$arch.tar.gz"
 curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 300 "https://github.com/go-gost/gost/releases/download/v${gostVersion}/$archive" -o "$temporary/gost.tar.gz"
 printf '%s  %s\\n' "$expected" "$temporary/gost.tar.gz" | sha256sum -c -
 tar -xzf "$temporary/gost.tar.gz" -C "$temporary" gost
 install -m 0755 "$temporary/gost" /opt/firefly-forward/gost-${gostVersion}
fi
`+stop+`python3 - <<'FIREFLY_PORT_CHECK'
import socket
for kind in ${JSON.stringify(rule.protocol==='both'?['tcp','udp']:[rule.protocol])}:
    s=socket.socket(socket.AF_INET, socket.SOCK_STREAM if kind=='tcp' else socket.SOCK_DGRAM)
    if kind=='tcp': s.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
    try: s.bind(('0.0.0.0', ${rule.listen_port}))
    except OSError: raise SystemExit('监听端口 ${rule.listen_port} 已被占用（'+kind+'），请选择其他端口')
    finally: s.close()
FIREFLY_PORT_CHECK
install -d -m 0700 /etc/firefly-forward
metrics_port=$(python3 - <<'FIREFLY_METRICS_PORT'
import socket
while True:
    with socket.socket() as s:
        s.bind(('127.0.0.1',0))
        port=s.getsockname()[1]
    if port!=${rule.listen_port}:
        print(port)
        break
FIREFLY_METRICS_PORT
)
cat > "/opt/firefly-forward/run-${rule.id}.sh" <<FIREFLY_WRAPPER
#!/bin/sh
set -eu
umask 077
python3 - <<'FIREFLY_MANIFEST'
import json, os, uuid
path='/etc/firefly-forward/${rule.id}.json'
with open(path+'.new','w',encoding='utf-8') as f:
    json.dump({'id':'${rule.id}','epoch':str(uuid.uuid4()),'port':$metrics_port},f)
os.chmod(path+'.new',0o600)
os.replace(path+'.new',path)
FIREFLY_MANIFEST
exec /opt/firefly-forward/gost-${gostVersion} ${urls.map(u=>'-L '+u).join(' ')} -metrics 127.0.0.1:$metrics_port
FIREFLY_WRAPPER
chmod 0755 "/opt/firefly-forward/run-${rule.id}.sh"
if [ "$manager" = systemd ]; then
cat > "/etc/systemd/system/$unit.service" <<'FIREFLY_UNIT'
[Unit]
Description=Firefly GOST forwarding
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/opt/firefly-forward/run-${rule.id}.sh
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/etc/firefly-forward
[Install]
WantedBy=multi-user.target
FIREFLY_UNIT
 systemctl daemon-reload
 systemctl enable --now "$unit"
 sleep 2
 systemctl is-active --quiet "$unit" || { journalctl -u "$unit" -n 20 --no-pager; exit 1; }
else
cat > "/etc/init.d/$unit" <<'FIREFLY_OPENRC'
#!/sbin/openrc-run
description="Firefly GOST forwarding"
command="/opt/firefly-forward/run-${rule.id}.sh"
supervisor="supervise-daemon"
respawn_delay=5
respawn_max=0
depend() { need net; }
FIREFLY_OPENRC
 chmod 0755 "/etc/init.d/$unit"
 rc-update add "$unit" default
 rc-service "$unit" start
 sleep 2
 rc-service "$unit" status
fi
echo FIREFLY_FORWARD_ACTIVE
`;
}
export function createForwarding(db,ssh,timezone=()=> 'Asia/Shanghai'){
 const key=id=>'forwarding:'+id;
 const records=()=>db.prepare("SELECT key,value FROM settings WHERE key LIKE 'forwarding:%'").all().map(r=>JSON.parse(r.value));
 const save=r=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key(r.id),JSON.stringify(r));
 const erase=id=>{db.prepare('DELETE FROM settings WHERE key=?').run(key(id));for(const prefix of ['forward_month:','forward_day:'])db.prepare('DELETE FROM settings WHERE key LIKE ?').run(prefix+id+':%');};
 const monthKey=(id,month)=>'forward_month:'+id+':'+month;
 function traffic(r){const month=dayKey(new Date(),timezone()).slice(0,7),saved=db.prepare('SELECT value FROM settings WHERE key=?').get(monthKey(r.id,month));return {month,...(saved?JSON.parse(saved.value):{rx:0,tx:0}),sampled:r.counter?.sampled??0,available:r.metrics_available??false};}
 function history(id){if(!records().some(r=>r.id===id))fail(404,'规则不存在');return db.prepare("SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key DESC LIMIT 24").all('forward_month:'+id+':%').map(row=>({month:row.key.slice(-7),...JSON.parse(row.value)}));}
 function dailyHistory(id,month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'月份格式无效');const months=history(id),total=months.find(m=>m.month===month)??{rx:0,tx:0};const days=db.prepare("SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key DESC").all('forward_day:'+id+':'+month+'-%').map(row=>({date:row.key.slice(-10),...JSON.parse(row.value)}));return {month,total,days,unassigned:{rx:Math.max(0,total.rx-days.reduce((sum,d)=>sum+d.rx,0)),tx:Math.max(0,total.tx-days.reduce((sum,d)=>sum+d.tx,0))}};}
 function ingest(nodeID,samples){if(samples===undefined)return;if(!Array.isArray(samples)||samples.length>200)fail(400,'转发统计格式无效');for(const s of samples){
  if(!s||typeof s.id!=='string'||typeof s.epoch!=='string'||!/^[a-f0-9-]{36}$/.test(s.epoch)||!Number.isInteger(s.sampled)||s.sampled<1||s.sampled>Date.now()/1000+300||typeof s.available!=='boolean')fail(400,'转发统计样本无效');
  const stored=db.prepare('SELECT value FROM settings WHERE key=?').get(key(s.id));if(!stored)continue;const r=JSON.parse(stored.value);if(r.node_id!==nodeID)continue;
  if(s.sampled<=(r.last_sampled??r.counter?.sampled??0))continue;
  r.last_sampled=s.sampled;
  if(!s.available){r.metrics_available=false;save(r);continue;}
  for(const field of ['rx','tx','errors'])if(!Number.isSafeInteger(s[field])||s[field]<0||s[field]>8e15)fail(400,'转发计数无效');
  const old=r.counter,same=old?.epoch===s.epoch,delta=k=>same&&s[k]>=old[k]?s[k]-old[k]:s[k];const rx=delta('rx'),tx=delta('tx'),errors=delta('errors');
  const date=dayKey(new Date(s.sampled*1000),timezone()),month=date.slice(0,7),mkey=monthKey(r.id,month),row=db.prepare('SELECT value FROM settings WHERE key=?').get(mkey),totals=row?JSON.parse(row.value):{rx:0,tx:0};totals.rx+=rx;totals.tx+=tx;
  db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(mkey,JSON.stringify(totals));
  const dkey='forward_day:'+r.id+':'+date,oldDay=db.prepare('SELECT value FROM settings WHERE key=?').get(dkey),day=oldDay?JSON.parse(oldDay.value):{rx:0,tx:0};day.rx+=rx;day.tx+=tx;db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(dkey,JSON.stringify(day));
  const obsolete=db.prepare("SELECT key FROM settings WHERE key LIKE ? ORDER BY key DESC LIMIT -1 OFFSET 24").all('forward_month:'+r.id+':%');for(const row of obsolete){db.prepare('DELETE FROM settings WHERE key=?').run(row.key);db.prepare('DELETE FROM settings WHERE key LIKE ?').run('forward_day:'+r.id+':'+row.key.slice(-7)+'-%');}
  r.counter={epoch:s.epoch,sampled:s.sampled,rx:s.rx,tx:s.tx,errors:s.errors};r.metrics_available=true;if(!same)r.health='waiting';if(errors>0){r.health='failed';r.health_at=s.sampled;}else if(rx+tx>0){r.health='success';r.health_at=s.sampled;}save(r);
 }}
 function reconcile(r){if(r.job_id){let job;try{job=ssh.status(r.job_id);}catch{}if(job&&job.status!=='running'&&r.checked_job!==job.id){r.checked_job=job.id;r.state=job.status==='failed'?'error':job.log.includes('FIREFLY_FORWARD_ACTIVE')?'running':'stopped';r.last_log=job.log;if(job.status==='success'&&r.action==='remove'){erase(r.id);return null;}save(r);}return {...r,job:job??null};}return r;}
 return {
  list(){return records().map(reconcile).filter(Boolean).map(r=>({...r,traffic:traffic(r)}));},
  ingest,history,dailyHistory,
  hasNode(id){return records().map(reconcile).filter(Boolean).some(r=>r.node_id===id);},
  add(input){if(!input||typeof input.node_id!=='string'||!/^[a-f0-9-]{36}$/.test(input.node_id))fail(400,'请选择有效服务器');if(records().length>=200)fail(400,'最多 200 条规则');const node=db.prepare('SELECT * FROM nodes WHERE id=?').get(input.node_id);if(!node)fail(404,'服务器不存在');if(!node.ssh_host||!node.ssh_password||!node.ssh_fingerprint)fail(400,'请先配置 SSH、测试连接并确认指纹');const fields=forwardingFields(input);const protocols=p=>p==='both'?['tcp','udp']:[p];if(records().some(r=>r.node_id===node.id&&r.listen_port===fields.listen_port&&protocols(r.protocol).some(p=>protocols(fields.protocol).includes(p))))fail(409,'该服务器已有相同端口和协议的规则');const r={id:randomUUID(),node_id:node.id,...fields,state:'not_deployed',created:Math.floor(Date.now()/1000)};save(r);return r;},
  action(id,action){const r=records().find(r=>r.id===id);if(!r)fail(404,'规则不存在');if(!['start','stop','status','remove'].includes(action))fail(400,'转发操作无效');if(action==='remove'&&!r.job_id&&r.state==='not_deployed'){erase(id);return {removed:true};}const job=ssh.runManaged(r.node_id,forwardScript(r,action));r.job_id=job.id;r.action=action;save(r);return job;}
 };
}
