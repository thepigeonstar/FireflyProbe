import {dayKey} from './store.mjs';
export function forwardServerHistory(db,timezone,params){
 const node=params.get('node')||'',days=Number(params.get('days')||30);if(![15,30,60,90].includes(days))throw Object.assign(new Error('历史范围无效'),{status:400});if(node&&!db.prepare('SELECT id FROM nodes WHERE id=?').get(node))throw Object.assign(new Error('服务器不存在'),{status:404});
 const rules=db.prepare("SELECT value FROM settings WHERE key LIKE 'forwarding:%'").all().map(r=>JSON.parse(r.value)).filter(r=>!node||r.node_id===node),byID=new Map(rules.map(r=>[r.id,r])),ids=[...new Set(rules.map(r=>r.node_id))];
 const end=dayKey(new Date(),timezone),start=new Date(Date.parse(end+'T12:00:00Z')-(days-1)*864e5).toISOString().slice(0,10);
 const dates=new Map();for(const record of db.prepare("SELECT key,value FROM settings WHERE key LIKE 'forward_day:%' AND substr(key,-10)>=? AND substr(key,-10)<=?").all(start,end)){const rule=byID.get(record.key.slice(12,-11));if(!rule)continue;const date=record.key.slice(-10),value=JSON.parse(record.value),row=dates.get(date)||{date,rx:0,tx:0,nodes:new Set()};row.rx+=value.rx;row.tx+=value.tx;row.nodes.add(rule.node_id);dates.set(date,row);}
 const rows=[...dates.values()].sort((a,b)=>b.date.localeCompare(a.date)).map(({nodes,...row})=>({...row,servers:nodes.size}));
 return {node,days,start,end,timezone,basis:'gost',server_count:ids.length,rows};
}
