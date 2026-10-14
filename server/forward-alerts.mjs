import {inQuiet} from './alarms.mjs';
import {notificationSelected} from './notification-targets.mjs';
export function createForwardAlerts(db){
 const read=key=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;};
 const put=(key,value)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 const config=()=>({failure_notifications:read('forward_alert_config')?.failure_notifications===true});
 const history=()=>read('forward_alert_events')||[];
 function observe(nodes,rules,settings,enqueue,stamp=Math.floor(Date.now()/1000)){
  const old=read('forward_alert_state')||{},next={},events=history();let changed=false;
  const event=(id,status,name,server,nodeID,message)=>{const previous=old[id];next[id]=status;if(previous===status)return;changed=true;const failure=['offline','failed'].includes(status),recovery=['offline','failed'].includes(previous)&&status==='healthy';if(!failure&&!recovery)return;
   const entry={id:id+':'+stamp,kind:failure?(status==='offline'?'offline':'failed'):'recovery',name,server,node_id:nodeID,message,created:stamp};events.unshift(entry);
   if(id.startsWith('rule:')&&config().failure_notifications){const n=nodes.find(n=>n.id===nodeID);if(n?.enabled&&n.alerts_enabled&&!(n.maintenance_until>stamp)&&!inQuiet(settings,new Date(stamp*1000))&&notificationSelected(settings,'offline',nodeID))enqueue('forward-'+(failure?'failure':'recovery')+':'+nodeID+':'+id.slice(5)+':'+stamp,`${failure?'🔴':'🟢'} ${settings.brand_name} · ${server}\n转发规则：${name}\n${message}`);}
  };
  const involved=new Set(rules.map(r=>r.node_id));
  for(const n of nodes.filter(n=>involved.has(n.id))){const state=n.status==='offline'?'offline':n.status==='online'?'healthy':'idle';event('node:'+n.id,state,n.name,n.name,n.id,state==='offline'?'服务器离线，关联转发规则需检查':'服务器恢复在线');}
  for(const r of rules){const n=nodes.find(n=>n.id===r.node_id);const fresh=r.traffic?.available&&stamp-r.traffic.sampled<90&&stamp-(r.health_at||0)<300;
   const failed=r.state==='error'||fresh&&r.health==='failed';const state=failed?'failed':r.state==='running'&&fresh&&r.health==='success'?'healthy':['stopped','not_deployed'].includes(r.state)?'idle':old['rule:'+r.id]||'idle';
   event('rule:'+r.id,state,r.name||'未命名',n?.name||'未知服务器',r.node_id,failed?(r.state==='error'?'转发操作失败，请查看规则日志':'GOST 报告转发错误，请检查目标与日志'):'已再次观测到转发流量');
  }
  if(JSON.stringify(old)!==JSON.stringify(next))put('forward_alert_state',next);if(changed)put('forward_alert_events',events.slice(0,50));
 }
 return {config,history,observe,save(input){if(typeof input?.failure_notifications!=='boolean')throw Object.assign(new Error('告警设置格式无效'),{status:400});put('forward_alert_config',{failure_notifications:input.failure_notifications});if(!input.failure_notifications)db.prepare("UPDATE outbox SET status='failed',error='转发通知已关闭' WHERE status='pending' AND (event_key LIKE 'forward-failure:%' OR event_key LIKE 'forward-recovery:%')").run();return config();}};
}
