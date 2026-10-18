import {validDate} from './store.mjs';
import {nextExpiry} from './auto-renew.mjs';
const fail=(status,message)=>{throw Object.assign(new Error(message),{status});};
export function expiryView(node,today){
 const days=validDate(node.expires)&&validDate(today)?Math.round((Date.parse(node.expires+'T00:00:00Z')-Date.parse(today+'T00:00:00Z'))/86400000):null;
 const months=node.cost_months??1,next=days!==null&&days<=3?nextExpiry(node.expires,months,node.expires,node.renewal_anchor_day):null;
 return {days,due:days!==null&&days<=3,months,next:next?.expires||null};
}
export function renewManually(db,id,input,today,stamp){
 const node=db.prepare('SELECT * FROM nodes WHERE id=?').get(id);if(!node)fail(404,'服务器不存在');
 if(typeof input?.expected_expires!=='string'||!Number.isInteger(input.expected_months))fail(400,'请先查看并确认当前到期日和付款周期');
 if(input.expected_expires!==node.expires||input.expected_months!==node.cost_months)fail(409,'到期日或付款周期已变化，请刷新后重新确认');
 const view=expiryView(node,today);if(!view.due)fail(400,'仅到期前三天内或已到期的服务器可以确认续费');
 const next=nextExpiry(node.expires,view.months,node.expires,node.renewal_anchor_day);if(!next)fail(400,'无法计算新的到期日，请检查付款周期或日期');
 db.exec('BEGIN IMMEDIATE');
 try{
  const result=db.prepare('UPDATE nodes SET expires=?,renewal_anchor_day=? WHERE id=? AND expires=? AND cost_months=?').run(next.expires,next.anchor_day,id,node.expires,node.cost_months);if(!result.changes)fail(409,'到期日或付款周期已变化，请刷新后重新确认');
  db.prepare("UPDATE outbox SET status='failed',error='已手动确认续费，取消旧到期提醒' WHERE status='pending' AND (event_key LIKE ? OR event_key=?)").run('expiry:'+id+':'+node.expires+':%','expired:'+id+':'+node.expires);
  db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}
 return {ok:true,id,from:node.expires,expires:next.expires,months:view.months,confirmed_at:stamp};
}
