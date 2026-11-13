// Local database removal only. Never executes SSH or changes another server's rules.
export function forgetNode(db,id){
 const read=key=>{const row=db.prepare('SELECT value FROM settings WHERE key=?').get(key);return row?JSON.parse(row.value):null;},put=(key,value)=>db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(value));
 db.exec('BEGIN IMMEDIATE');
 try{
  const rows=db.prepare("SELECT key,value FROM settings WHERE key LIKE 'forwarding:%'").all().filter(row=>JSON.parse(row.value).node_id===id),ids=new Set();
  for(const row of rows){const r=JSON.parse(row.value);for(const entry of [r,r.pending_edit,r.cleanup_candidate])if(entry?.id)ids.add(entry.id);db.prepare('DELETE FROM settings WHERE key=?').run(row.key);}
  for(const rule of ids)for(const prefix of ['forward_day:','forward_month:'])db.prepare('DELETE FROM settings WHERE key LIKE ?').run(prefix+rule+':%');
  for(const key of ['node_system:'+id,'forward_engine:'+id,'forward_limit:'+id,'forward_limit_state:'+id])db.prepare('DELETE FROM settings WHERE key=?').run(key);
  for(const row of db.prepare("SELECT key,value FROM settings WHERE key LIKE 'forward_relay:%'").all()){const p=JSON.parse(row.value);if([p.source,p.entry,p.relay].some(r=>r?.node_id===id))db.prepare('DELETE FROM settings WHERE key=?').run(row.key);}
  const groups=read('forward_groups');if(groups)put('forward_groups',groups.map(g=>({...g,node_ids:g.node_ids.filter(n=>n!==id)})));
  const events=read('forward_alert_events');if(events)put('forward_alert_events',events.filter(e=>e.node_id!==id));
  const alerts=read('forward_alert_state');if(alerts){delete alerts['node:'+id];for(const rule of ids)delete alerts['rule:'+rule];put('forward_alert_state',alerts);}
  const config=read('config');if(config?.notification_targets){for(const type of Object.keys(config.notification_targets))if(Array.isArray(config.notification_targets[type]))config.notification_targets[type]=config.notification_targets[type].filter(n=>n!==id);put('config',config);}
  // Remove obsolete node/rule notifications, including pending deliveries.
  for(const row of db.prepare('SELECT id,event_key FROM outbox').all())if(row.event_key.split(':').some(part=>part===id||ids.has(part)))db.prepare('DELETE FROM outbox WHERE id=?').run(row.id);
  db.prepare('DELETE FROM nodes WHERE id=?').run(id);
  db.exec('COMMIT');return {rules:rows.length,notification_targets:config?.notification_targets};
 }catch(e){db.exec('ROLLBACK');throw e;}
}
