import {hasSSHCredentials} from './ssh-auth.mjs';
import {randomUUID} from 'node:crypto';
import {dayKey} from './store.mjs';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function createForwardLimit(db,forwarding,ssh,getNodes,timezone,notify=()=>{}){
 const configKey=id=>'forward_limit:'+id,stateKey=id=>'forward_limit_state:'+id;
 const read=key=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;},put=(key,value)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const config=id=>read(configKey(id))||{enabled:false,bytes:0},state=id=>read(stateKey(id));
 function usage(n,stamp){const today=dayKey(new Date(stamp*1000),timezone()),hasToday=db.prepare('SELECT 1 FROM daily WHERE node_id=? AND date=? LIMIT 1').get(n.id,today);return {bytes:n.traffic.measured,period:n.traffic.bounds.start,end:n.traffic.bounds.end,valid:Boolean(n.enabled&&n.status==='online'&&n.history_seen&&stamp-n.history_seen>=0&&stamp-n.history_seen<900&&!n.history_error&&n.history_timezone===timezone()&&dayKey(new Date(n.history_seen*1000),timezone())===today&&hasToday)};}
 function node(id){const n=getNodes().find(n=>n.id===id);if(!n)throw Object.assign(new Error('服务器不存在'),{status:404});return n;}
 function summary(n,stamp=Math.floor(Date.now()/1000)){
  try{
  const c=config(n.id),s=state(n.id);if(!c.enabled&&!s?.latched)return null;
  const u=usage(n,stamp),failed=s?.status==='error'||s?.items?.some(i=>i.status==='failed'),pending=s?.items?.some(i=>['queued','running'].includes(i.status));
  const status=!s?.latched?'protected':failed?(s.operation==='resume'?'restore_failed':'pause_failed'):s.operation==='resume'?'resuming':s.status==='paused'&&!pending?'paused':'stopping';
  return {status,enabled:Boolean(c.enabled),used:u.bytes,threshold:c.enabled?c.bytes:(s?.threshold||c.bytes),valid:u.valid,billing_mode:n.billing_mode};
  }catch{return {status:'state_error',enabled:null,used:n.traffic.measured,threshold:null,valid:false,billing_mode:n.billing_mode};}
 }
 function view(id,stamp=Math.floor(Date.now()/1000)){const n=node(id);return {config:config(id),state:state(id),usage:usage(n,stamp),timezone:timezone(),billing_mode:n.billing_mode,summary:summary(n,stamp)};}
 function assertStartAllowed(id,action,rule){const s=state(id),c=config(id);if(!s?.latched&&!c.enabled)return;if(s?.latched&&!(s.operation==='resume'&&action==='resume'&&s.items.some(i=>i.id===rule&&i.resume)))throw Object.assign(new Error('该服务器已因流量限额暂停，请调整阈值后手动恢复'),{status:409});const n=node(id),u=usage(n,Math.floor(Date.now()/1000));if(c.enabled&&u.valid&&u.bytes>=c.bytes&&s?.operation!=='resume')throw Object.assign(new Error('账单周期计费流量已达到暂停阈值，请先调整流量暂停设置'),{status:409});}
 function observe(nodes,stamp=Math.floor(Date.now()/1000)){
  if(nodes===undefined){const active=db.prepare("SELECT key,value FROM settings WHERE key LIKE 'forward_limit:%' OR key LIKE 'forward_limit_state:%'").all().some(r=>{const v=JSON.parse(r.value);return v.enabled||v.latched;});if(!active)return;nodes=getNodes();}
  for(const n of nodes){const c=config(n.id);let s=state(n.id);if(!c.enabled&&!s?.latched)continue;const u=usage(n,stamp);
   if(c.enabled&&u.valid&&u.bytes>=c.bytes&&(!s?.latched||s.operation==='resume')){
    if(s?.operation==='resume'&&ssh.busy(n.id))continue;
    const rules=forwarding.list().filter(r=>r.node_id===n.id&&(r.installed||r.job?.status==='running')&&(r.state!=='stopped'||r.job?.status==='running'));
    s={id:randomUUID(),latched:true,operation:'stop',status:'stopping',period:u.period,created:stamp,used:u.bytes,threshold:c.bytes,items:rules.map(r=>({id:r.id,name:r.name,was_running:r.state==='running'||r.job?.status==='running',status:'queued',attempts:0}))};put(stateKey(n.id),s);notify(n,'trigger',s);
   }
   if(!s?.latched||!['stop','resume'].includes(s.operation))continue;
   if(s.operation==='stop')for(const r of forwarding.list().filter(r=>r.node_id===n.id&&(r.installed||r.job?.status==='running')&&(r.state!=='stopped'||r.job?.status==='running'))){const item=s.items.find(i=>i.id===r.id);if(!item)s.items.push({id:r.id,name:r.name,was_running:true,status:'queued',attempts:0});else if(['stopped','removed'].includes(item.status)){item.status='queued';item.was_running=true;}}
   for(const item of s.items.filter(i=>i.status==='running')){
    try{const job=ssh.status(item.job_id);item.log=job.log||'';if(job.status==='running')continue;
     const r=forwarding.list().find(r=>r.id===item.id),ok=job.status==='success'&&(s.operation==='stop'?(!r||r.state==='stopped'):r?.state==='running');
     item.status=ok?(s.operation==='stop'?'stopped':'resumed'):'failed';if(!ok){item.next_retry=stamp+30;notify(n,'failed',s,item);}
    }catch{item.status='failed';item.log='任务中断或日志过期，将重试并核对远端状态';item.next_retry=stamp+30;}
   }
   if(!s.items.some(i=>i.status==='running')&&!ssh.busy(n.id)){
    const item=s.items.find(i=>(i.status==='queued'||i.status==='failed')&&(!i.next_retry||i.next_retry<=stamp));
    if(item){const r=forwarding.list().find(r=>r.id===item.id);
     if(!r){item.status='removed';}
     else if(s.operation==='stop'&&r.state==='stopped'){item.status='stopped';item.was_running=false;}
     else if(s.operation==='resume'&&!item.resume){item.status='skipped';}
     else try{item.attempts++;const job=forwarding.action(item.id,s.operation==='stop'?'stop':'resume');item.job_id=job.id;item.status='running';item.log=job.log||'正在连接 SSH…';delete item.next_retry;}catch(e){item.status='failed';item.log=e.message;item.next_retry=stamp+30;notify(n,'failed',s,item);}
    }
   }
   const pending=s.items.some(i=>['queued','running','failed'].includes(i.status));
   s.status=pending?(s.items.some(i=>i.status==='failed')?'error':s.operation==='stop'?'stopping':'resuming'):s.operation==='stop'?'paused':'restored';
   if(!pending&&s.operation==='resume'){s.latched=false;s.operation='idle';notify(n,'restored',s);}
   else if(!pending&&s.operation==='stop'&&!s.notified){s.notified=true;notify(n,'paused',s);}
   put(stateKey(n.id),s);
  }
 }
 return {view,summary,observe,assertStartAllowed,
  save(id,input){const n=node(id);if(typeof input?.enabled!=='boolean'||typeof input.limit_gib!=='number'||!Number.isFinite(input.limit_gib)||input.limit_gib<0||input.limit_gib*1073741824>8e15||input.enabled&&Math.round(input.limit_gib*1073741824)<1)fail('请填写有效的暂停阈值（GiB），启用时必须大于 0');if(input.enabled&&(!n.ssh_host||!hasSSHCredentials(n)||!n.ssh_fingerprint))fail('启用前请配置 SSH 并确认指纹，供主控执行暂停');const s=state(id);if(s?.operation==='resume')fail('恢复任务尚未结束，请稍后修改');put(configKey(id),{enabled:input.enabled,bytes:Math.round(input.limit_gib*1073741824)});return view(id);},
  resume(id){const n=node(id),c=config(id),s=state(id);if(!s?.latched)fail('该服务器没有流量暂停记录');if(s.items.some(i=>['queued','running','failed'].includes(i.status))||ssh.busy(id)||s.operation==='resume')fail('还有未确认完成的暂停任务，请核对日志并等待停止成功后恢复');const u=usage(n,Math.floor(Date.now()/1000));if(c.enabled&&(!u.valid||u.bytes>=c.bytes))fail('请先提高暂停阈值或关闭此功能；启用时需有效统计且当前用量低于阈值');
   if(!n.enabled||!n.ssh_host||!hasSSHCredentials(n)||!n.ssh_fingerprint)fail('请启用服务器并配置 SSH、确认指纹后恢复');
   s.operation='resume';s.status='resuming';s.items=s.items.filter(i=>i.status==='stopped'&&i.was_running).map(i=>({...i,resume:true,status:'queued',attempts:0,next_retry:0}));put(stateKey(id),s);return view(id);
  }
 };
}
