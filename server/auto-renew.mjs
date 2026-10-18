import {dayKey,validDate} from './store.mjs';
export function nextExpiry(expires,months,today,anchor=0){
 if(!validDate(expires)||!validDate(today)||!Number.isInteger(months)||months<1||months>120||expires>today)return null;
 const [year,month,day]=expires.split('-').map(Number),[todayYear,todayMonth]=today.split('-').map(Number),start=year*12+month-1,target=todayYear*12+todayMonth-1,anchorDay=anchor||day;
 let periods=Math.max(1,Math.floor((target-start)/months));
 for(let i=0;i<3;i++,periods++){const index=start+periods*months,y=Math.floor(index/12),m=index%12;if(y>9999)return null;const end=new Date(0);end.setUTCFullYear(y,m+1,0);const result=String(y).padStart(4,'0')+'-'+String(m+1).padStart(2,'0')+'-'+String(Math.min(anchorDay,end.getUTCDate())).padStart(2,'0');if(result>today)return {expires:result,anchor_day:anchorDay,periods};}
 return null;
}
export function renewOnlineNodes(db,nodes,timezone,stamp){
 const today=dayKey(new Date(stamp*1000),timezone),renewed=[];
 for(const n of nodes){if(!n.enabled||!n.auto_renew||n.status!=='online'||!n.last_seen||n.last_seen>stamp+5||!n.expires||n.expires>today||dayKey(new Date(n.last_seen*1000),timezone)<n.expires)continue;
  const next=nextExpiry(n.expires,n.auto_renew_months,today,n.renewal_anchor_day);if(!next)continue;
  const result=db.prepare('UPDATE nodes SET expires=?,renewal_anchor_day=?,last_renewed_at=?,last_renewed_from=? WHERE id=? AND expires=? AND auto_renew=1 AND enabled=1').run(next.expires,next.anchor_day,stamp,n.expires,n.id,n.expires);if(!result.changes)continue;
  db.prepare("UPDATE outbox SET status='failed',error='到期日已自动续期，取消旧提醒' WHERE status='pending' AND (event_key LIKE ? OR event_key=?)").run('expiry:'+n.id+':'+n.expires+':%','expired:'+n.id+':'+n.expires);
  renewed.push({id:n.id,from:n.expires,to:next.expires,periods:next.periods});
 }
 return renewed;
}
