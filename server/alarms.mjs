import {notificationSelected} from './notification-targets.mjs';
export const alarmDefaults={cpu_threshold:90,mem_threshold:90,disk_threshold:90,alert_duration:300,expiry_days:[7,3,1,0],quiet_enabled:false,quiet_start:'23:00',quiet_end:'08:00',backup_enabled:true,backup_keep:7,public_enabled:false,public_show_metrics:true,public_show_system:false,public_show_traffic:false};
export function inQuiet(settings,at=new Date()) {
  if(!settings.quiet_enabled||settings.quiet_start===settings.quiet_end)return false;
  const p=Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(at).map(x=>[x.type,x.value]));
  const time=p.hour+':'+p.minute;
  return settings.quiet_start<settings.quiet_end?time>=settings.quiet_start&&time<settings.quiet_end:time>=settings.quiet_start||time<settings.quiet_end;
}
export function processAlarms(db,node,settings,stamp,today,enqueue) {
  const quiet=inQuiet(settings,new Date(stamp*1000));
  if(!node.alerts_enabled||node.maintenance_until>stamp||quiet){db.prepare('DELETE FROM alerts WHERE node_id=?').run(node.id);return;}
  if(node.expires&&notificationSelected(settings,'expiry',node.id)){const days=Math.round((Date.parse(node.expires)-Date.parse(today))/864e5);const threshold=settings.expiry_days.filter(x=>x>=days).sort((a,b)=>a-b)[0];if(days>=0&&threshold!==undefined)enqueue(`expiry:${node.id}:${node.expires}:${threshold}`,`📅 ${settings.brand_name} · ${node.name} 距到期 ${days} 天\n到期日期：${node.expires}`);if(days<0)enqueue(`expired:${node.id}:${node.expires}`,`📅 ${settings.brand_name} · ${node.name} 已到期\n到期日期：${node.expires}`);}
  if(!notificationSelected(settings,'resource',node.id)){db.prepare('DELETE FROM alerts WHERE node_id=?').run(node.id);return;}
  const m=node.metrics;
  for(const [kind,value,label] of [['cpu',m?.cpu,'CPU'],['mem',m?.mem_total?m.mem_used/m.mem_total*100:null,'内存'],['disk',m?.disk_total?m.disk_used/m.disk_total*100:null,'磁盘']]){
    const row=db.prepare('SELECT * FROM alerts WHERE node_id=? AND kind=?').get(node.id,kind);
    if(node.status!=='online'||value===null||value===undefined||value<settings[kind+'_threshold']){
      if(row?.active&&node.status==='online')enqueue(`resource-recovery:${node.id}:${kind}:${row.since}`,`🟢 ${settings.brand_name} · ${node.name} ${label} 恢复正常`);
      if(row)db.prepare('DELETE FROM alerts WHERE node_id=? AND kind=?').run(node.id,kind);continue;
    }
    if(!row)db.prepare('INSERT INTO alerts(node_id,kind,since) VALUES(?,?,?)').run(node.id,kind,stamp);
    const since=row?.since??stamp;
    if(!row?.active&&stamp-since>=settings.alert_duration&&enqueue(`resource:${node.id}:${kind}:${since}`,`⚠️ ${settings.brand_name} · ${node.name} ${label} 持续过高\n当前 ${value.toFixed(1)}%，阈值 ${settings[kind+'_threshold']}%，持续 ${settings.alert_duration} 秒`))db.prepare('UPDATE alerts SET active=1 WHERE node_id=? AND kind=?').run(node.id,kind);
  }
}
