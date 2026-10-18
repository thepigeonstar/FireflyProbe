import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {expiryView,renewManually} from '../server/manual-renew.mjs';import {nextExpiry} from '../server/auto-renew.mjs';import {openStore,dayKey} from '../server/store.mjs';import {createApp} from '../server/main.mjs';
test('临期含未来三天及全部逾期，手动续费按付款周期延长一次并保留月底锚点',()=>{
 for(const [expires,due,days] of [['2026-10-20',true,2],['2026-10-21',true,3],['2026-10-22',false,4],['2026-10-16',true,-2],['2026-10-18',true,0],['',false,null]])assert.deepEqual(expiryView({expires,cost_months:3},'2026-10-18'),{days,due,months:3,next:due?nextExpiry(expires,3,expires).expires:null});
 const dir=mkdtempSync(join(tmpdir(),'manual-renew-')),db=openStore(join(dir,'db.sqlite'));
 try{
  for(const [id,expires,months] of [['month','2026-01-31',1],['quarter','2026-10-16',3],['year','2026-10-20',12],['overdue','2025-10-18',1]])db.prepare('INSERT INTO nodes(id,token_hash,name,created,expires,cost_months) VALUES(?,?,?,1,?,?)').run(id,id,id,expires,months);
  const renew=(id,expected_expires,expected_months,today)=>renewManually(db,id,{expected_expires,expected_months},today,1);
  for(const event of ['expiry:quarter:2026-10-16:0','expired:quarter:2026-10-16','expiry:quarter:2027-01-16:3','other:test'])db.prepare('INSERT INTO outbox(event_key,message,created) VALUES(?,?,1)').run(event,'fixture');
  assert.equal(renew('month','2026-01-31',1,'2026-01-28').expires,'2026-02-28');assert.equal(renew('month','2026-02-28',1,'2026-02-25').expires,'2026-03-31');assert.equal(renew('quarter','2026-10-16',3,'2026-10-18').expires,'2027-01-16');assert.equal(renew('year','2026-10-20',12,'2026-10-18').expires,'2027-10-20');assert.equal(renew('overdue','2025-10-18',1,'2026-10-18').expires,'2025-11-18');
  assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='failed'").get().n,2);assert.equal(db.prepare('SELECT auto_renew FROM nodes WHERE id=?').get('quarter').auto_renew,1);
  assert.throws(()=>renew('quarter','2026-10-16',3,'2026-10-18'),{status:409});assert.throws(()=>renew('quarter','2027-01-16',1,'2027-01-16'),{status:409});assert.throws(()=>renew('year','2027-10-20',12,'2026-10-18'),{status:400});
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('手动续费接口要求登录和 CSRF、核对旧日期及周期，默认离线可续，重复请求不加两次',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'manual-renew-api-')),app=await createApp({password:'manual-renew-password',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,headers={'Content-Type':'application/json'},call=(path,method='GET',input)=>fetch(base+path,{method,headers,body:input===undefined?undefined:JSON.stringify(input)});
 try{
  assert.equal((await call('/api/nodes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/renew','POST',{})).status,401);
  const login=await call('/admin/api/login','POST',{username:'admin',password:'manual-renew-password'}),session=await login.json();headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=session.csrf;
  const today=dayKey(new Date(),'Asia/Shanghai'),plus=days=>new Date(Date.parse(today+'T00:00:00Z')+days*86400000).toISOString().slice(0,10);
  const a=await(await call('/api/nodes','POST',{name:'季付离线',expires:plus(2),cost_months:3,auto_renew:false})).json(),b=await(await call('/api/nodes','POST',{name:'四日后',expires:plus(4)})).json(),c=await(await call('/api/nodes','POST',{name:'已到期',expires:plus(-2),cost_months:12})).json();
  const list=(await(await call('/api/nodes')).json()).nodes;assert.equal(list.find(n=>n.id===a.id).expiry.due,true);assert.equal(list.find(n=>n.id===b.id).expiry.due,false);assert.equal(list.find(n=>n.id===c.id).expiry.days,-2);
  const path='/api/nodes/'+a.id+'/renew',input={expected_expires:plus(2),expected_months:3};assert.equal((await fetch(base+path,{method:'POST',headers:{'Content-Type':'application/json',Cookie:headers.Cookie},body:JSON.stringify(input)})).status,403);
  assert.equal((await call(path,'POST',{expected_expires:plus(2),expected_months:1})).status,409);const result=await(await call(path,'POST',input)).json();assert.equal(result.expires,nextExpiry(plus(2),3,plus(2)).expires);assert.equal((await call(path,'POST',input)).status,409);assert.equal(app.db.prepare('SELECT auto_renew FROM nodes WHERE id=?').get(a.id).auto_renew,0);
  assert.equal((await call('/api/nodes/'+b.id+'/renew','POST',{expected_expires:plus(4),expected_months:1})).status,400);assert.equal((await call('/api/nodes/'+c.id+'/renew','POST',{expected_expires:plus(-2),expected_months:12})).status,200);assert.equal((await call(path,'POST',{})).status,400);assert.equal((await call('/api/nodes/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee/renew','POST',input)).status,404);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
