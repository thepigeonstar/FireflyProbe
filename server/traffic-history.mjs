import {dayKey} from './store.mjs';

export function trafficHistory(db,settings,params){
 const node=params.get('node'),period=params.get('period')||'daily',days=Number(params.get('days')||30);
 if(!['daily','monthly'].includes(period)||![15,30,60,90].includes(days))throw Object.assign(Error('历史范围无效'),{status:400});
 if(node&&!db.prepare('SELECT id FROM nodes WHERE id=?').get(node))throw Object.assign(Error('服务器不存在'),{status:404});
 const today=dayKey(new Date(),settings.timezone),start=period==='daily'?new Date(Date.parse(today)-(days-1)*864e5).toISOString().slice(0,10):new Date(Date.parse(today)-(settings.keep_days-1)*864e5).toISOString().slice(0,10);
 const key=period==='monthly'?"substr(d.date,1,7)":'d.date';
 const rows=db.prepare(`SELECT ${key} date,SUM(d.rx) rx,SUM(d.tx) tx,COUNT(DISTINCT d.date) sample_days FROM daily d JOIN nodes n ON n.id=d.node_id WHERE d.date>=? AND d.date<=? AND ${node?'n.id=?':'n.enabled=1'} GROUP BY ${key} ORDER BY date DESC`).all(start,today,...(node?[node]:[]));
 return {period,days,start,end:today,timezone:settings.timezone,keep_days:settings.keep_days,rows};
}
