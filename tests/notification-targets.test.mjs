import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';
import {dayKey} from '../server/store.mjs';
import {notificationTypes,notificationSelected,validateTargets} from '../server/notification-targets.mjs';

test('通知选择：默认全部（包含新服务器）、空列表关闭、分类独立校验',()=>{
  assert.equal(notificationSelected({},'quota','new-node'),true);assert.equal(notificationSelected({notification_targets:{quota:[]}},'quota','n'),false);assert.equal(notificationSelected({notification_targets:{quota:['a']}},'quota','a'),true);assert.equal(notificationSelected({notification_targets:{quota:['a']}},'report','b'),true);assert.throws(()=>validateTargets({quota:'all'}));assert.throws(()=>validateTargets({quota:['not-an-id']}));assert.throws(()=>validateTargets({unexpected:[]}));
});
test('通知按服务器分别筛选流量预警、日报、离线、资源、到期，设置互不覆盖',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-notify-scope-')),app=await createApp({password:'notification-admin-test-2026',dbPath:join(dir,'db.sqlite'),disableTelegram:true});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
  const call=async(path,method='GET',data)=>{const response=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});return {status:response.status,body:await response.json(),response};};
  try{
    const login=await call('/api/login','POST',{username:'admin',password:'notification-admin-test-2026'});headers={...headers,Cookie:login.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.body.csrf};
    const today=dayKey(new Date(),'Asia/Shanghai'),nodes=[];for(const name of ['节点甲','节点乙','节点丙'])nodes.push((await call('/api/nodes','POST',{name,quota:100,expires:today})).body);const [a,b,c]=nodes;
    for(const n of [a,b]){const response=await fetch(base+'/api/agent/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+n.token},body:JSON.stringify({hostname:'fixture',interface:'eth0',rx_speed:1,tx_speed:2,cpu:99,mem_total:100,mem_used:99,disk_total:100,disk_used:99,uptime:1,days:[{date:today,rx:90,tx:90}],history_timezone:'Asia/Shanghai'})});assert.equal(response.status,200);}
    app.db.prepare('UPDATE nodes SET last_seen=? WHERE id=?').run(Math.floor(Date.now()/1000)-3600,c.id);
    const targets={quota:[a.id],report:[b.id],offline:[c.id],resource:[a.id],expiry:[b.id]};
    assert.equal((await call('/api/settings','PUT',{telegram_token:'123456:TEST_NOT_REAL',telegram_chat:'123',report_enabled:true,report_hour:0,report_minute:0,alert_duration:15,notification_targets:targets})).status,200);
    await app.notifications();app.db.prepare('UPDATE alerts SET since=since-30').run();await app.notifications();
    const jobs=app.db.prepare('SELECT * FROM outbox').all();
    for(const [prefix,id] of [['quota',a.id],['offline',c.id],['resource',a.id],['expiry',b.id]]){const matches=jobs.filter(j=>j.event_key.startsWith(prefix+':'));assert.ok(matches.length,prefix);assert.ok(matches.every(j=>j.event_key.split(':')[1]===id),prefix+' excludes others');}
    const daily=jobs.find(j=>j.event_key.startsWith('daily:'));assert.ok(daily.message.includes('节点乙'));assert.ok(!daily.message.includes('节点甲'));assert.ok(!daily.message.includes('节点丙'));
    await call('/api/settings','PUT',{brand_name:'测试品牌'});assert.deepEqual((await call('/api/settings')).body.notification_targets,targets);
    const before=(await call('/api/settings')).body;assert.equal((await call('/api/settings','PUT',{notification_targets:{quota:['invalid']}})).status,400);assert.deepEqual((await call('/api/settings')).body.notification_targets,before.notification_targets);
    const none=Object.fromEntries(notificationTypes.map(type=>[type,[]]));await call('/api/settings','PUT',{notification_targets:none});assert.equal(app.db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='pending'").get().n,0);app.db.prepare('DELETE FROM outbox').run();await app.notifications();assert.equal(app.db.prepare('SELECT COUNT(*) n FROM outbox').get().n,0);assert.equal(app.db.prepare('SELECT COUNT(*) n FROM alerts').get().n,0);
    await call('/api/settings','PUT',{notification_targets:Object.fromEntries(notificationTypes.map(type=>[type,null]))});const d=(await call('/api/nodes','POST',{name:'新增节点丁'})).body;await app.notifications();const fresh=app.db.prepare("SELECT message FROM outbox WHERE event_key LIKE 'daily:%'").get();assert.ok(fresh.message.includes('新增节点丁'));assert.ok(d.id);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
