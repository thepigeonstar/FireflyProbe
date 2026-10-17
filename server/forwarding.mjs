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
 if(!/^[a-f0-9-]{36}$/.test(rule.id)||!['start','resume','stop','status','remove'].includes(action))fail(400,'转发操作无效');
 const unit='firefly-forward-'+rule.id,urls=forwardURLs(forwardingFields(rule));
 const pre=`#!/bin/sh\nset -eu\numask 077\nexport PYTHONUTF8=1 PYTHONIOENCODING=utf-8\n[ "$(id -u)" = 0 ] || { echo '需要 root 或免密 sudo'; exit 1; }\nunit=${quote(unit)}\nif command -v systemctl >/dev/null; then manager=systemd; elif [ -x /sbin/openrc-run ]; then manager=openrc; else echo '需要 systemd 或 OpenRC'; exit 1; fi\n`;
 const status=`if [ "$manager" = systemd ]; then if systemctl is-active --quiet "$unit"; then echo FIREFLY_FORWARD_ACTIVE; else echo FIREFLY_FORWARD_STOPPED; fi; else if rc-service "$unit" status >/dev/null 2>&1; then echo FIREFLY_FORWARD_ACTIVE; else echo FIREFLY_FORWARD_STOPPED; fi; fi\n`;
 if(action==='status')return pre+status;
 if(action==='resume')return pre+`if [ "$manager" = systemd ]; then
 [ -f "/etc/systemd/system/$unit.service" ] || { echo '服务文件不存在，请点击更新重新部署'; exit 1; }
 systemctl enable --now "$unit"
 sleep 2
 systemctl is-active --quiet "$unit"
else
 [ -f "/etc/init.d/$unit" ] || { echo '服务文件不存在，请点击更新重新部署'; exit 1; }
 rc-update add "$unit" default
 rc-service "$unit" start
 sleep 2
 rc-service "$unit" status
fi
echo FIREFLY_FORWARD_ACTIVE
`;

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
 const installed=r=>r.installed??(['running','stopped'].includes(r.state)||Boolean(r.counter)||String(r.last_log||'').includes('FIREFLY_FORWARD_ACTIVE'));
 const monthKey=(id,month)=>'forward_month:'+id+':'+month;
 function traffic(r){const month=dayKey(new Date(),timezone()).slice(0,7),saved=db.prepare('SELECT value FROM settings WHERE key=?').get(monthKey(r.id,month));return {month,...(saved?JSON.parse(saved.value):{rx:0,tx:0}),sampled:r.counter?.sampled??0,available:r.metrics_available??false,counter_error:r.counter_error||''};}
 function history(id){if(!records().some(r=>r.id===id))fail(404,'规则不存在');return db.prepare("SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key DESC LIMIT 24").all('forward_month:'+id+':%').map(row=>({month:row.key.slice(-7),...JSON.parse(row.value)}));}
 function dailyHistory(id,month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))fail(400,'月份格式无效');const months=history(id),total=months.find(m=>m.month===month)??{rx:0,tx:0};const days=db.prepare("SELECT key,value FROM settings WHERE key LIKE ? ORDER BY key DESC").all('forward_day:'+id+':'+month+'-%').map(row=>({date:row.key.slice(-10),...JSON.parse(row.value)}));return {month,total,days,unassigned:{rx:Math.max(0,total.rx-days.reduce((sum,d)=>sum+d.rx,0)),tx:Math.max(0,total.tx-days.reduce((sum,d)=>sum+d.tx,0))}};}
 function summary(at=new Date(),nodeID=''){
  const zone=timezone(),today=dayKey(at,zone),yesterday=new Date(Date.parse(today+'T12:00:00Z')-86400000).toISOString().slice(0,10),rules=records().filter(r=>!nodeID||r.node_id===nodeID);
  const total=date=>{const sum={date,rx:0,tx:0};for(const r of rules){const row=db.prepare('SELECT value FROM settings WHERE key=?').get('forward_day:'+r.id+':'+date);if(row){const d=JSON.parse(row.value);sum.rx+=d.rx;sum.tx+=d.tx;}}return {...sum,total:sum.rx+sum.tx};};
  return {timezone:zone,rule_count:rules.length,today:total(today),yesterday:total(yesterday)};
 }
 function ingest(nodeID,samples){if(samples===undefined)return;if(!Array.isArray(samples)||samples.length>200)fail(400,'转发统计格式无效');for(const s of samples){
  if(!s||typeof s.id!=='string'||typeof s.epoch!=='string'||!/^[a-f0-9-]{36}$/.test(s.epoch)||!Number.isInteger(s.sampled)||s.sampled<1||s.sampled>Date.now()/1000+300||typeof s.available!=='boolean')fail(400,'转发统计样本无效');
  const stored=db.prepare('SELECT value FROM settings WHERE key=?').get(key(s.id));if(!stored)continue;const r=JSON.parse(stored.value);if(r.node_id!==nodeID||r.pending_edit)continue;
  if(s.sampled<=(r.last_sampled??r.counter?.sampled??0))continue;
  r.last_sampled=s.sampled;
  if(!s.available){r.metrics_available=false;save(r);continue;}
  for(const field of ['rx','tx','errors'])if(!Number.isSafeInteger(s[field])||s[field]<0||s[field]>8e15)fail(400,'转发计数无效');
  const old=r.counter,same=old?.epoch===s.epoch;if(same&&['rx','tx','errors'].some(k=>s[k]<old[k])){r.metrics_available=false;r.counter_error='同一进程的累计计数回退，保留原基线，暂不累加此样本';save(r);continue;}delete r.counter_error;const delta=k=>same?s[k]-old[k]:s[k];const rx=delta('rx'),tx=delta('tx'),errors=delta('errors');
  const date=dayKey(new Date(s.sampled*1000),timezone()),month=date.slice(0,7),mkey=monthKey(r.id,month),row=db.prepare('SELECT value FROM settings WHERE key=?').get(mkey),totals=row?JSON.parse(row.value):{rx:0,tx:0};totals.rx+=rx;totals.tx+=tx;
  db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(mkey,JSON.stringify(totals));
  const dkey='forward_day:'+r.id+':'+date,oldDay=db.prepare('SELECT value FROM settings WHERE key=?').get(dkey),day=oldDay?JSON.parse(oldDay.value):{rx:0,tx:0};day.rx+=rx;day.tx+=tx;db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(dkey,JSON.stringify(day));
  const obsolete=db.prepare("SELECT key FROM settings WHERE key LIKE ? ORDER BY key DESC LIMIT -1 OFFSET 24").all('forward_month:'+r.id+':%');for(const row of obsolete){db.prepare('DELETE FROM settings WHERE key=?').run(row.key);db.prepare('DELETE FROM settings WHERE key LIKE ?').run('forward_day:'+r.id+':'+row.key.slice(-7)+'-%');}
  r.counter={epoch:s.epoch,sampled:s.sampled,rx:s.rx,tx:s.tx,errors:s.errors};r.metrics_available=true;if(!same)r.health='waiting';if(errors>0){r.health='failed';r.health_at=s.sampled;}else if(rx+tx>0){r.health='success';r.health_at=s.sampled;}save(r);
 }}
 function reconcile(r,completed){if(r.job_id){let job=completed;try{job??=ssh.status(r.job_id);}catch{}if(job&&job.status!=='running'&&r.checked_job!==job.id){r.installed=installed(r);r.checked_job=job.id;r.state=job.status==='failed'?'error':job.log.includes('FIREFLY_FORWARD_ACTIVE')?'running':'stopped';r.last_log=job.log;if(job.status==='success'&&r.state==='running')r.installed=true;
   if(r.action==='edit'&&r.pending_edit){if(job.status==='success'){const updated={...r.pending_edit,job_id:job.id,checked_job:job.id,state:'running',installed:true,action:'start',last_log:job.log,replaced_id:r.id};db.exec('BEGIN IMMEDIATE');try{erase(r.id);save(updated);db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {...updated,job};}r.cleanup_candidate=r.pending_edit;delete r.pending_edit;}
   if(job.status==='success')delete r.cleanup_candidate;
   if(job.status==='success'&&r.action==='remove'){erase(r.id);return null;}save(r);}return {...r,job:job??null};}return r;}
 function collision(fields,nodeID,exclude,entries=records()){const protocols=p=>p==='both'?['tcp','udp']:[p];if(entries.filter(r=>r.id!==exclude).flatMap(r=>[r,r.pending_edit,r.cleanup_candidate].filter(Boolean)).some(r=>r.node_id===nodeID&&r.listen_port===fields.listen_port&&protocols(r.protocol).some(p=>protocols(fields.protocol).includes(p))))fail(409,'该服务器已有相同端口和协议的规则');}
 function update(id,input){const r=records().map(record=>reconcile(record)).filter(Boolean).find(r=>r.id===id);if(!r)fail(404,'规则不存在');delete r.job;if(ssh.busy(r.node_id))fail(409,'该服务器正在部署，请稍后修改');if(input.node_id!==undefined&&input.node_id!==r.node_id)fail(400,'编辑规则不能更换服务器');const fields=forwardingFields(input);collision(fields,r.node_id,r.id);if(!installed(r)&&r.state==='not_deployed'&&!r.job_id){save({...r,...fields});return {saved:true,id:r.id};}const candidate={id:randomUUID(),node_id:r.node_id,...fields,sort:r.sort,created:r.created};
   const leftover=r.pending_edit??r.cleanup_candidate;const newScript=(leftover?forwardScript(leftover,'remove'):'')+"echo '步骤 1/3：停止原规则服务。'\n"+forwardScript(r,'stop')+"echo '步骤 2/3：部署并启动新规则服务。'\n"+forwardScript(candidate,'start')+"echo '步骤 3/3：清理原规则服务文件，保留新规则运行。'\n"+forwardScript(r,'remove'),rollback=forwardScript(candidate,'remove')+(r.state==='not_deployed'?'':forwardScript(r,'start')+(r.state==='stopped'?forwardScript(r,'stop'):''));
   const script="set -eu\nif sh -s <<'FIREFLY_NEW_RULE'\n"+newScript+"FIREFLY_NEW_RULE\nthen\n"+"echo '修改部署成功，新规则已运行。'\necho FIREFLY_FORWARD_ACTIVE\nelse\n echo '修改部署失败，正在尝试恢复原规则…'\n if sh -s <<'FIREFLY_ROLLBACK_RULE'\n"+rollback+"FIREFLY_ROLLBACK_RULE\n then echo '原规则已恢复。'; else echo '原规则恢复失败，请检查上述日志和远端服务。'; fi\n exit 1\nfi\n";
   const job=ssh.runManaged(r.node_id,script,completed=>{if(!db.isOpen)return;const current=db.prepare('SELECT value FROM settings WHERE key=?').get(key(r.id));if(current)reconcile(JSON.parse(current.value),completed);});r.pending_edit=candidate;r.action='edit';r.job_id=job.id;save(r);return job;
 }

 return {
  list(){return records().map(record=>reconcile(record)).filter(Boolean).sort((a,b)=>(a.sort??a.created??0)-(b.sort??b.created??0)||a.id.localeCompare(b.id)).map(r=>({...r,installed:installed(r),traffic:traffic(r)}));},
  ingest,history,dailyHistory,update,summary,
  copy(input){
   if(!input||typeof input.source_node_id!=='string'||!Array.isArray(input.rule_ids)||!input.rule_ids.length||input.rule_ids.length>200||new Set(input.rule_ids).size!==input.rule_ids.length||!Array.isArray(input.target_node_ids)||!input.target_node_ids.length||input.target_node_ids.length>200||new Set(input.target_node_ids).size!==input.target_node_ids.length)fail(400,'请选择来源规则和目标服务器，不能重复');
   const all=records().map(r=>reconcile(r)).filter(Boolean),nodes=db.prepare('SELECT id,name FROM nodes').all(),targets=input.target_node_ids.map(id=>nodes.find(n=>n.id===id));if(!nodes.some(n=>n.id===input.source_node_id)||targets.some(n=>!n)||input.target_node_ids.includes(input.source_node_id))fail(400,'来源或目标服务器无效，不能复制到自身');
   const selected=input.rule_ids.map(id=>all.find(r=>r.id===id&&r.node_id===input.source_node_id));if(selected.some(r=>!r))fail(400,'所选规则不属于来源服务器，或已被修改 / 删除');if(selected.some(r=>r.pending_edit||r.job?.status==='running'))fail(409,'来源规则正在执行任务，请完成后再复制');
   const created=[],skipped=[];db.exec('BEGIN IMMEDIATE');try{for(const n of targets)for(const r of selected){const fields=forwardingFields(r);let reason='';try{collision(fields,n.id,undefined,all);}catch(e){if(e.status!==409)throw e;reason='监听端口和协议与已有规则冲突';}if(!reason&&all.length>=200)reason='规则总数已达到 200 条上限';if(reason){skipped.push({node_id:n.id,server:n.name,name:r.name,reason});continue;}
    const copy={id:randomUUID(),node_id:n.id,...fields,sort:Math.max(-1,...all.filter(r=>r.node_id===n.id).map(r=>r.sort??r.created??0))+1,state:'not_deployed',installed:false,created:Math.floor(Date.now()/1000)};save(copy);all.push(copy);created.push({id:copy.id,node_id:n.id,server:n.name,name:copy.name});
   }db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {created,skipped};
  },
  reorder(nodeID,ids){if(typeof nodeID!=='string'||!db.prepare('SELECT id FROM nodes WHERE id=?').get(nodeID))fail(404,'服务器不存在');const rules=records().filter(r=>r.node_id===nodeID);if(!Array.isArray(ids)||ids.length!==rules.length||new Set(ids).size!==ids.length||ids.some(id=>!rules.some(r=>r.id===id)))fail(400,'排序必须包含该服务器的全部规则，且不能重复');db.exec('BEGIN IMMEDIATE');try{ids.forEach((id,index)=>save({...rules.find(r=>r.id===id),sort:index}));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}return {ok:true};},
  hasNode(id){return records().map(record=>reconcile(record)).filter(Boolean).some(r=>r.node_id===id);},
  add(input){if(!input||typeof input.node_id!=='string'||!/^[a-f0-9-]{36}$/.test(input.node_id))fail(400,'请选择有效服务器');if(records().length>=200)fail(400,'最多 200 条规则');const node=db.prepare('SELECT * FROM nodes WHERE id=?').get(input.node_id);if(!node)fail(404,'服务器不存在');if(!node.ssh_host||!node.ssh_password||!node.ssh_fingerprint)fail(400,'请先配置 SSH、测试连接并确认指纹');const fields=forwardingFields(input);collision(fields,node.id);const r={id:randomUUID(),node_id:node.id,...fields,sort:Math.max(-1,...records().filter(r=>r.node_id===node.id).map(r=>r.sort??r.created??0))+1,state:'not_deployed',installed:false,created:Math.floor(Date.now()/1000)};save(r);return r;},
  action(id,action){const r=records().find(r=>r.id===id);if(!r)fail(404,'规则不存在');if(!['start','resume','stop','status','remove'].includes(action))fail(400,'转发操作无效');if(r.pending_edit&&action!=='remove')fail(409,'编辑任务未完成，请重新编辑部署，或删除规则后重建');if(action==='remove'&&!r.job_id&&r.state==='not_deployed'){erase(id);return {removed:true};}const leftover=r.pending_edit??r.cleanup_candidate;const script=(leftover?forwardScript(leftover,'remove'):'')+forwardScript(r,action);const job=ssh.runManaged(r.node_id,script);r.installed=installed(r);r.job_id=job.id;r.action=action;save(r);return job;}
 };
}
