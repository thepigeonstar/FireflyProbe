import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {createApp} from '../server/main.mjs';
test('转发工作台 API 认证、CSRF、输入校验、公开隔离及缺少 SSH 跳过',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-dashboard-')),app=await createApp({dbPath:join(dir,'db.sqlite'),password:'dashboard-test-password',disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,headers={'Content-Type':'application/json'};
 const call=(path,method='GET',body)=>fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
 try{
  assert.equal((await call('/api/forwarding/batch')).status,401);assert.equal((await call('/api/forwarding/alerts')).status,401);
  const login=await call('/admin/api/login','POST',{username:'admin',password:'dashboard-test-password'}),session=await login.json();headers.Cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/forwarding/alerts','PUT',{failure_notifications:true})).status,403);assert.equal((await call('/api/forwarding/batch','POST',{})).status,403);headers['X-CSRF-Token']=session.csrf;
  assert.equal((await call('/api/forwarding/batch','POST',null)).status,400);assert.equal((await call('/api/forwarding/batch','POST',{node_id:'missing'})).status,404);assert.equal((await call('/api/forwarding/batch','POST',{})).status,400);
  const node=await (await call('/api/nodes','POST',{name:'没有 SSH 的服务器'})).json(),id='aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';app.db.prepare('INSERT INTO settings VALUES(?,?)').run('forwarding:'+id,JSON.stringify({id,node_id:node.id,name:'规则',protocol:'tcp',listen_port:80,target_host:'127.0.0.1',target_port:443,state:'not_deployed'}));
  const response=await call('/api/forwarding/batch','POST',{node_id:node.id}),batch=await response.json();assert.equal(response.status,202);assert.equal(batch.status,'complete');assert.equal(batch.items[0].status,'skipped');assert.equal(batch.items[0].message,'未配置 SSH');
  assert.equal((await call('/api/forwarding/alerts','PUT',{failure_notifications:'true'})).status,400);assert.equal((await call('/api/forwarding/alerts','PUT',{failure_notifications:true})).status,200);assert.equal((await (await call('/api/forwarding/alerts')).json()).failure_notifications,true);
  const data=await (await call('/api/forwarding')).json();assert.equal(data.nodes.length,1);assert.equal(data.batch.status,'complete');assert.ok(!JSON.stringify(data).includes('token_hash'));assert.ok(!JSON.stringify(data).includes('ssh_password'));assert.equal(data.summary.rule_count,1);
  delete headers.Cookie;delete headers['X-CSRF-Token'];assert.equal((await call('/api/forwarding')).status,401);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
