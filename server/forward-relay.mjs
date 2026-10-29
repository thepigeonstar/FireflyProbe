import {randomUUID} from 'node:crypto';
import {forwardingFields} from './forwarding.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
const fingerprint=r=>JSON.stringify([r.id,r.node_id,r.name,r.protocol,r.listen_port,r.target_host,r.target_port,r.state,r.job_id??null]);
const sameTarget=(a,b)=>['node_id','protocol','listen_port','target_host','target_port'].every(k=>a?.[k]===b?.[k]);
export function createForwardRelay(db,forwarding,ssh,getNodes){
 const key=id=>'forward_relay:'+id,all=()=>db.prepare("SELECT value FROM settings WHERE key LIKE 'forward_relay:%'").all().map(r=>JSON.parse(r.value));
 const save=p=>{db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key(p.id),JSON.stringify(p));return p;};
 const read=id=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key(id));if(!row)fail(404,'中转任务不存在');return JSON.parse(row.value);};
 function view(id){const p=read(id);if(!['relay_running','entry_running'].includes(p.status))return p;
  const entry=p.status==='entry_running';try{const job=ssh.status(entry?p.entry_job:p.relay_job);p[entry?'entry_log':'relay_log']=job.log||'';
   if(job.status!=='running'){
    const rules=forwarding.list();
    if(job.status!=='success'||!job.log.includes('FIREFLY_FORWARD_ACTIVE')){p.status='failed';p.error=entry?'入口修改失败，请核对入口日志与远端状态。':'中转未确认启动，入口规则未修改。';}
    else if(entry){const r=rules.find(r=>r.replaced_id===p.source.id)||rules.find(r=>r.id===p.source.id);if(!r||!sameTarget(r,p.entry)){p.status='failed';p.error='入口配置与任务不一致，请核对实际规则。';}else{p.entry_id=r.id;p.status='success';}}
    else p.status='relay_ready';
   }
  }catch{p.status='interrupted';p.error='任务已中断或日志已过期，请检查远端规则；不会自动继续切换入口。';}
  return save(p);
 }
 function readyNode(id){const n=getNodes().find(n=>n.id===id);if(!n||!n.enabled)fail(400,'请选择启用的服务器');if(!n.ssh_host||!n.ssh_password||!n.ssh_fingerprint)fail(400,'请先配置 SSH 并确认指纹');if(ssh.busy(id))fail(409,'服务器有任务正在执行，请稍后重试');return n;}
 return {
  view,latest(rule){const current=forwarding.list().find(r=>r.id===rule),p=all().filter(p=>p.source.id===rule||p.entry_id===rule||current?.replaced_id===p.source.id&&current?.job_id===p.entry_job).sort((a,b)=>b.created-a.created)[0];return p?view(p.id):null;},
  begin(rule,input){
   if(!input||typeof input!=='object'||Array.isArray(input))fail(400,'中转配置无效');
   const rules=forwarding.list(),source=rules.find(r=>r.id===rule);if(!source)fail(404,'原规则不存在');if(!source.installed||source.pending_edit||source.job?.status==='running')fail(409,'请先安装原规则并完成现有任务');
   if(input.expected!==fingerprint(source))fail(409,'原规则已变化，请关闭窗口重新打开');
   if(source.node_id===input.node_id)fail(400,'中转服务器不能是入口服务器');readyNode(source.node_id);const node=readyNode(input.node_id);
   if(['localhost','::1','0:0:0:0:0:0:0:1','0.0.0.0','::'].includes(source.target_host)||/^127\./.test(source.target_host))fail(400,'原目标是入口本机地址，请先改为中转服务器能够访问的落地地址');
   for(const old of all().filter(p=>p.source.id===rule)){const status=view(old.id).status;if(['relay_running','relay_ready','entry_running'].includes(status))fail(409,'该规则已有中转任务，请先继续或放弃原任务');}
   const fields=forwardingFields({name:(source.name||'转发').slice(0,65)+' · 中转',protocol:source.protocol,listen_port:input.listen_port,target_host:source.target_host,target_port:source.target_port});
   const entry={node_id:source.node_id,...forwardingFields({...source,target_host:input.host||node.ssh_host,target_port:fields.listen_port})};
   if(['localhost','::1','0:0:0:0:0:0:0:1','0.0.0.0','::'].includes(entry.target_host)||/^127\./.test(entry.target_host))fail(400,'中转地址不能是本机地址');
   if(entry.target_host===source.target_host&&entry.target_port===source.target_port)fail(400,'中转地址与原目标相同，请检查端口');
   const overlap=r=>r.node_id===node.id&&r.listen_port===fields.listen_port&&(r.protocol==='both'||fields.protocol==='both'||r.protocol===fields.protocol);
   const existing=rules.find(overlap);if(existing&&(!sameTarget(existing,{node_id:node.id,...fields})||!existing.installed||existing.state!=='running'||existing.pending_edit||existing.job?.status==='running'))fail(409,'中转端口已占用，请换一个端口；仅可复用同协议、同目标且运行中的规则');
   const peer=getNodes().find(n=>n.id===source.node_id);
   if((entry.target_host===peer.ssh_host&&entry.target_port===source.listen_port)||(source.target_host===entry.target_host&&source.target_port===fields.listen_port))fail(400,'配置会指回自身，请检查中转地址和端口');
   const relay=existing||forwarding.add({node_id:node.id,...fields}),snapshot=Object.fromEntries(['id','node_id','name','protocol','listen_port','target_host','target_port','state','job_id'].map(k=>[k,source[k]??null])),p={id:randomUUID(),created:Date.now(),source:snapshot,expected:fingerprint(source),entry,relay:{id:relay.id,node_id:node.id,...fields},relay_name:node.name,entry_name:peer.name,status:'relay_running',reused:Boolean(existing),relay_log:'',entry_log:''};
   // Only rule configuration and job references are persisted; no SSH credentials.
   try{const job=forwarding.action(relay.id,existing?'status':'start');p.relay_job=job.id;p.relay_log=job.log||'';}catch(e){p.status='failed';p.error='中转部署未提交：'+e.message+'。入口未修改。';}return save(p);
  },
  apply(id){const p=view(id);if(p.status!=='relay_ready')fail(409,'请先完成中转安装 / 检查');const rules=forwarding.list(),source=rules.find(r=>r.id===p.source.id),relay=rules.find(r=>r.id===p.relay.id);
   if(!source||fingerprint(source)!==p.expected)fail(409,'入口规则已变化，不会覆盖，请放弃任务后重新配置');
   if(!relay||!sameTarget(relay,p.relay)||relay.state!=='running'||relay.job_id!==p.relay_job)fail(409,'中转规则已变化，请放弃任务后重新检查');
   readyNode(source.node_id);readyNode(relay.node_id);
   const job=forwarding.update(source.id,p.entry);p.entry_job=job.id;p.entry_log=job.log||'';p.status='entry_running';return save(p);
  },
  cancel(id){const p=view(id);if(['entry_running','success'].includes(p.status))fail(409,'入口已提交修改，无法在此放弃，请检查规则');p.status='cancelled';p.error='已放弃入口切换；已创建的中转规则保留，可单独管理或删除。';return save(p);},
  routes(rules){const result={},nodes=getNodes(),byID=new Map(rules.map(r=>[r.id,r])),plans=all().map(p=>['relay_running','entry_running'].includes(p.status)?view(p.id):p);for(const p of plans.filter(p=>p.status==='success').sort((a,b)=>b.created-a.created)){
   const entry=byID.get(p.entry_id),relay=byID.get(p.relay.id),valid=sameTarget(entry,p.entry)&&sameTarget(relay,p.relay);
   for(const id of [p.entry_id,p.relay.id])if(byID.has(id)&&!result[id])result[id]=valid?{role:id===p.entry_id?'entry':'relay',entry:nodes.find(n=>n.id===p.source.node_id)?.name||p.entry_name,relay:nodes.find(n=>n.id===p.relay.node_id)?.name||p.relay_name,target:p.relay.target_host,port:p.relay.target_port}:{warning:'关联规则已修改或删除，请核对中转路径'};
  }return result;},fingerprint
 };
}
