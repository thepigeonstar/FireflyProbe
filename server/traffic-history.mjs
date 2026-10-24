import {dayKey,validDate} from './store.mjs';

export function trafficRankings(db,settings,params){
 const today=dayKey(new Date(),settings.timezone),start=new Date(Date.parse(today+'T12:00:00Z')-(settings.keep_days-1)*864e5).toISOString().slice(0,10),date=params.get('date')||today;
 if(!validDate(date)||date<start||date>today)throw Object.assign(Error('请选择数据保留范围内的日期'),{status:400});
 const rows=db.prepare('SELECT n.id,n.name,n.country_override,n.country_code,COUNT(d.date) samples,SUM(d.rx) rx,SUM(d.tx) tx FROM nodes n LEFT JOIN daily d ON d.node_id=n.id AND d.date=? WHERE n.enabled=1 GROUP BY n.id ORDER BY SUM(d.rx)+SUM(d.tx) DESC,n.id').all(date).map(({samples,rx,tx,country_override,...n})=>({...n,country_code:country_override||n.country_code,has_sample:samples>0,rx:samples?rx:null,tx:samples?tx:null,total:samples?rx+tx:null}));
 return {date,today,start,timezone:settings.timezone,rows};
}

export function trafficHistory(db,settings,params){
 const node=params.get('node'),period=params.get('period')||'daily',days=Number(params.get('days')||30);
 if(!['daily','monthly'].includes(period)||![15,30,60,90].includes(days))throw Object.assign(Error('历史范围无效'),{status:400});
 if(node&&!db.prepare('SELECT id FROM nodes WHERE id=?').get(node))throw Object.assign(Error('服务器不存在'),{status:404});
 const today=dayKey(new Date(),settings.timezone),start=period==='daily'?new Date(Date.parse(today)-(days-1)*864e5).toISOString().slice(0,10):new Date(Date.parse(today)-(settings.keep_days-1)*864e5).toISOString().slice(0,10);
 const key=period==='monthly'?"substr(d.date,1,7)":'d.date';
 const rows=db.prepare(`SELECT ${key} date,SUM(d.rx) rx,SUM(d.tx) tx,COUNT(DISTINCT d.date) sample_days FROM daily d JOIN nodes n ON n.id=d.node_id WHERE d.date>=? AND d.date<=? AND ${node?'n.id=?':'n.enabled=1'} GROUP BY ${key} ORDER BY date DESC`).all(start,today,...(node?[node]:[]));
 return {period,days,start,end:today,timezone:settings.timezone,keep_days:settings.keep_days,rows};
}
