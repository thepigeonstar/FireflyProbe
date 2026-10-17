export function createForwardBatch(forwarding,ssh,getNodes){
 let batch=null,timer=null,stopped=false;
 const view=()=>batch?structuredClone(batch):{status:'idle',items:[]};
 function step(){if(stopped||batch?.status!=='running')return;
  for(const item of batch.items.filter(i=>i.status==='running')){try{const job=ssh.status(item.job_id);item.message=job.log;if(job.status!=='running'){item.status=job.status==='success'?'success':'failed';forwarding.list();}}catch(e){item.status='failed';item.message=e.message||'任务已中断';}}
  for(const item of batch.items.filter(i=>i.status==='queued')){if(batch.items.some(i=>i.status==='running'))break;if(ssh.busy(item.node_id))break;try{const job=forwarding.action(item.id,'start');item.status='running';item.job_id=job.id;item.message=job.log||'正在连接 SSH…';}catch(e){if(e.status===429)break;item.status='failed';item.message=e.message;}}
  if(!batch.items.some(i=>['queued','running'].includes(i.status))){batch.status='complete';batch.finished=Math.floor(Date.now()/1000);return;}timer=setTimeout(step,1000);timer.unref();
 }
 return {view,get busy(){return batch?.status==='running';},start(nodeID='',scope=null){
  if(stopped)throw Object.assign(new Error('主控正在停止'),{status:503});if(batch?.status==='running')throw Object.assign(new Error('已有转发安装 / 更新队列正在执行'),{status:409});
  const nodes=getNodes();if(typeof nodeID!=='string'||nodeID&&!nodes.some(n=>n.id===nodeID))throw Object.assign(new Error('服务器不存在'),{status:404});
  if(scope!==null&&(!Array.isArray(scope)||scope.some(id=>!nodes.some(n=>n.id===id))))throw Object.assign(new Error('分组范围无效'),{status:400});const rules=forwarding.list().filter(r=>(!nodeID||r.node_id===nodeID)&&(scope===null||scope.includes(r.node_id)));if(!rules.length)throw Object.assign(new Error('当前范围没有转发规则'),{status:400});
  const items=rules.map(r=>{const n=nodes.find(n=>n.id===r.node_id),reason=!n?'服务器不存在':!n.enabled?'服务器已停用':!n.ssh_host||!n.ssh_password?'未配置 SSH':!n.ssh_fingerprint?'未确认 SSH 指纹':r.pending_edit?'编辑部署尚未完成':'';return {id:r.id,node_id:r.node_id,name:r.name||'未命名',server:n?.name||'未知服务器',operation:r.installed?'更新':'安装',status:reason?'skipped':'queued',message:reason};});
  batch={status:'running',node_id:nodeID,node_ids:scope,created:Math.floor(Date.now()/1000),items};step();return view();
 },cancel(){stopped=true;clearTimeout(timer);if(batch?.status==='running'){batch.status='interrupted';for(const i of batch.items)if(['running','queued'].includes(i.status)){i.status='failed';i.message='主控停止，队列已中断';}}},reset(){stopped=false;}};
}
