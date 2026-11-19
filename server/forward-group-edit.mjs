import {createHash} from 'node:crypto';
import {forwardingFields} from './forwarding.mjs';
import {hasSSHCredentials} from './ssh-auth.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export const ruleRevision=r=>JSON.stringify([r.id,r.node_id,r.name,r.protocol,r.listen_port,r.target_host,r.target_port,r.installed,r.state,r.job_id,r.pending_edit,r.cleanup_candidate]);
export function groupEditPlan(forwarding,nodes,groups,id,input){
 const fields=forwardingFields(input?.fields),rules=forwarding.list(),source=rules.find(r=>r.id===id),group=groups.find(g=>g.id===input.group_id);
 if(!source)fail(404,'来源规则不存在');
 if(!group||!group.node_ids.includes(source.node_id))fail(400,'来源服务器不属于此转发分组');
 const overlaps=(a,b)=>a==='both'||b==='both'||a===b;
 const ids=[source.node_id,...group.node_ids.filter(n=>n!==source.node_id)];
 const items=ids.map(node_id=>{
  const n=nodes.find(n=>n.id===node_id),matches=rules.filter(r=>r.node_id===node_id&&r.listen_port===source.listen_port&&r.protocol===source.protocol),r=matches.length===1?matches[0]:null;
  const draft=r&&!r.installed&&r.state==='not_deployed'&&!r.job_id;
  const reason=!n?'服务器不存在':matches.length!==1?(matches.length?'对应规则不唯一':'没有相同监听端口和协议的规则'):r.pending_edit||r.cleanup_candidate||r.job?.status==='running'?'规则存在未完成任务':!draft&&!n.enabled?'服务器已停用':!draft&&(!n.ssh_host||!hasSSHCredentials(n))?'未配置 SSH':!draft&&!n.ssh_fingerprint?'未确认 SSH 指纹':rules.some(x=>x.node_id===node_id&&x.id!==r.id&&[x,x.pending_edit,x.cleanup_candidate].filter(Boolean).some(x=>x.listen_port===fields.listen_port&&overlaps(x.protocol,fields.protocol)))?'修改后的监听端口和协议冲突':'';
  return {id:r?.id||node_id,node_id,server:n?.name||'未知服务器',host:n?.ssh_host||'',name:r?.name||source.name,operation:draft?'保存配置':'编辑并部署',status:reason?'skipped':'queued',message:reason,revision:r?ruleRevision(r):null};
 });
 if(items[0].status==='skipped')fail(409,items[0].message);
 const expected=createHash('sha256').update(JSON.stringify({group,fields,items})).digest('hex');
 return {group_id:group.id,group_name:group.name,fields,items,expected};
}
