export function createAgentBatch(ssh,getNodes){
 let batch=null,timer=null,stopped=false;
 const view=()=>batch?structuredClone(batch):{status:'idle',items:[]};
 function step(){if(stopped||batch?.status!=='running')return;
  for(const item of batch.items.filter(i=>i.status==='running')){let job;try{job=ssh.status(item.job_id);}catch{item.status='failed';item.message='任务已中断，请检查采集端状态';continue;}item.message=job.log;if(job.status!=='running')item.status=job.status==='success'?'success':'failed';}
  for(const item of batch.items.filter(i=>i.status==='queued')){if(batch.items.some(i=>i.status==='running'))break;try{const job=ssh.deploy(item.id);item.status='running';item.job_id=job.id;item.message=job.log||'正在连接 SSH…';}catch(e){if(e.status===409||e.status===429)break;item.status='failed';item.message=e.message;}}
  if(!batch.items.some(i=>['queued','running'].includes(i.status))){batch.status='complete';batch.finished=Math.floor(Date.now()/1000);return;}
  timer=setTimeout(step,1000);timer.unref();
 }
 return {
  get busy(){return batch?.status==='running';},view,
  start(){if(stopped)throw Object.assign(new Error('主控正在停止'),{status:503});if(batch?.status==='running')throw Object.assign(new Error('已有全部更新任务正在进行'),{status:409});
   const items=getNodes().map(n=>{const reason=!n.enabled?'服务器已停用':!n.last_version?'尚未接入采集端':!n.ssh_host||!n.ssh_password?'未配置 SSH':!n.ssh_fingerprint?'未确认 SSH 指纹':'';return {id:n.id,name:n.name,status:reason?'skipped':'queued',message:reason};});
   batch={status:'running',created:Math.floor(Date.now()/1000),items};step();return view();
  },
  cancel(){stopped=true;clearTimeout(timer);if(batch?.status==='running'){batch.status='interrupted';for(const item of batch.items)if(['queued','running'].includes(item.status)){item.status='failed';item.message='主控停止，更新队列已中断';}}},
  reset(){stopped=false;}
 };
}
