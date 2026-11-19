import {hasSSHCredentials} from './ssh-auth.mjs';
import {groupEditPlan,ruleRevision} from './forward-group-edit.mjs';
export function createForwardBatch(forwarding,ssh,getNodes,getGroups=()=>[]){
 let batch=null,timer=null,stopped=false;
 const view=()=>batch?structuredClone(batch):{status:'idle',items:[]};
 function step(){if(stopped||batch?.status!=='running')return;
  for(const item of batch.items.filter(i=>i.status==='running')){try{const job=ssh.status(item.job_id);item.message=job.log;if(job.status!=='running'){item.status=job.status==='success'?'success':'failed';forwarding.list();}}catch(e){item.status='failed';item.message=e.message||'任务已中断';}}
  for(const item of batch.items.filter(i=>i.status==='queued')){if(batch.items.some(i=>i.status==='running'))break;if(ssh.busy(item.node_id))break;try{
   if(batch.action==='group_edit'){
    if(!getGroups().find(g=>g.id===batch.group_id)?.node_ids.includes(item.node_id))throw new Error('服务器分组已变化，请重新确认');
    const r=forwarding.list().find(r=>r.id===item.id);if(!r||ruleRevision(r)!==item.revision)throw new Error('规则已变化，请重新确认');
    const n=getNodes().find(n=>n.id===item.node_id);if(!n||r.installed&&(!n.enabled||!hasSSHCredentials(n)||!n.ssh_fingerprint))throw new Error('服务器或 SSH 配置已变化');
   }
   const job=batch.action==='group_edit'?forwarding.update(item.id,batch.fields):forwarding.action(item.id,batch.action||'start');if(job.saved||job.removed){item.status='success';item.message=job.saved?'配置已保存，尚未部署':'未安装配置已删除';continue;}item.status='running';item.job_id=job.id;item.message=job.log||'正在连接 SSH…';}catch(e){if(e.status===429)break;item.status='failed';item.message=e.message;}}
  if(!batch.items.some(i=>['queued','running'].includes(i.status))){batch.status='complete';batch.finished=Math.floor(Date.now()/1000);return;}timer=setTimeout(step,1000);timer.unref();
 }
 return {view,get busy(){return batch?.status==='running';},previewGroupEdit(id,input){return groupEditPlan(forwarding,getNodes(),getGroups(),id,input);},startGroupEdit(id,input){
  if(stopped)throw Object.assign(new Error('主控正在停止'),{status:503});
  if(batch?.status==='running')throw Object.assign(new Error('已有转发队列正在执行'),{status:409});
  const plan=groupEditPlan(forwarding,getNodes(),getGroups(),id,input);
  if(typeof input.expected!=='string'||input.expected!==plan.expected)throw Object.assign(new Error('分组或规则已变化，请重新预览确认'),{status:409});
  batch={...plan,action:'group_edit',status:'running',created:Math.floor(Date.now()/1000)};step();return view();
 },start(nodeID='',scope=null,action='start',ruleIDs=null){
  if(stopped)throw Object.assign(new Error('主控正在停止'),{status:503});if(batch?.status==='running')throw Object.assign(new Error('已有转发安装 / 更新队列正在执行'),{status:409});
  if(!['start','remove'].includes(action))throw Object.assign(new Error('批量操作无效'),{status:400});
  if(action==='remove'&&(!Array.isArray(ruleIDs)||!ruleIDs.length)||ruleIDs!==null&&(!Array.isArray(ruleIDs)||ruleIDs.length>10000||ruleIDs.some(id=>typeof id!=='string')||new Set(ruleIDs).size!==ruleIDs.length))throw Object.assign(new Error('请选择有效且不重复的规则'),{status:400});
  const nodes=getNodes();if(typeof nodeID!=='string'||nodeID&&!nodes.some(n=>n.id===nodeID))throw Object.assign(new Error('服务器不存在'),{status:404});
  if(scope!==null&&(!Array.isArray(scope)||scope.some(id=>!nodes.some(n=>n.id===id))))throw Object.assign(new Error('分组范围无效'),{status:400});const rules=forwarding.list().filter(r=>(!nodeID||r.node_id===nodeID)&&(scope===null||scope.includes(r.node_id)));if(!rules.length)throw Object.assign(new Error('当前范围没有转发规则'),{status:400});
  if(ruleIDs!==null&&ruleIDs.some(id=>!rules.some(r=>r.id===id)))throw Object.assign(new Error('所选规则已变化或不在当前范围，请重新选择'),{status:409});
  const items=rules.filter(r=>ruleIDs===null||ruleIDs.includes(r.id)).map(r=>{const n=nodes.find(n=>n.id===r.node_id),draft=action==='remove'&&!r.installed&&r.state==='not_deployed'&&!r.job_id,reason=r.job?.status==='running'?'规则任务正在执行':draft?'':!n?'服务器不存在':!n.enabled?'服务器已停用':!n.ssh_host||!hasSSHCredentials(n)?'未配置 SSH':!n.ssh_fingerprint?'未确认 SSH 指纹':action==='start'&&r.pending_edit?'编辑部署尚未完成':'';return {id:r.id,node_id:r.node_id,name:r.name||'未命名',server:n?.name||'未知服务器',operation:action==='remove'?'删除':r.installed?'更新':'安装',status:reason?'skipped':'queued',message:reason};});
  batch={status:'running',action,node_id:nodeID,node_ids:scope,created:Math.floor(Date.now()/1000),items};step();return view();
 },cancel(){stopped=true;clearTimeout(timer);if(batch?.status==='running'){batch.status='interrupted';for(const i of batch.items)if(['running','queued'].includes(i.status)){i.status='failed';i.message='主控停止，队列已中断';}}},reset(){stopped=false;}};
}
