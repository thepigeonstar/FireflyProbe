import {dayKey} from './store.mjs';
export function forwardServerHistory(db,timezone,params){
 const node=params.get('node')||'',days=Number(params.get('days')||30);if(![15,30,60,90].includes(days))throw Object.assign(new Error('历史范围无效'),{status:400});if(node&&!db.prepare('SELECT id FROM nodes WHERE id=?').get(node))throw Object.assign(new Error('服务器不存在'),{status:404});
 const ids=node?[node]:[...new Set(db.prepare("SELECT value FROM settings WHERE key LIKE 'forwarding:%'").all().map(r=>JSON.parse(r.value).node_id))].filter(id=>db.prepare('SELECT id FROM nodes WHERE id=? AND enabled=1').get(id));
 const end=dayKey(new Date(),timezone),start=new Date(Date.parse(end+'T12:00:00Z')-(days-1)*864e5).toISOString().slice(0,10);
 const rows=ids.length?db.prepare(`SELECT date,SUM(rx) rx,SUM(tx) tx,COUNT(DISTINCT node_id) servers FROM daily WHERE node_id IN (${ids.map(()=>'?').join(',')}) AND date>=? AND date<=? GROUP BY date ORDER BY date DESC`).all(...ids,start,end):[];
 return {node,days,start,end,timezone,basis:'interface',server_count:ids.length,rows};
}
