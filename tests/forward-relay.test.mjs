import test from 'node:test';import assert from 'node:assert/strict';import {randomUUID} from 'node:crypto';import {mkdtempSync,rmSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';
import {openStore} from '../server/store.mjs';import {createForwarding} from '../server/forwarding.mjs';import {createForwardRelay} from '../server/forward-relay.mjs';import {createApp} from '../server/main.mjs';
function fixture(mode='legacy'){
 const dir=mkdtempSync(join(tmpdir(),'forward-relay-')),db=openStore(join(dir,'db.sqlite')),jobs=new Map(),submitted=[],nodes=['入口A','中转B','新中转D'].map((name,i)=>({id:randomUUID(),name,enabled:1,ssh_host:`192.0.2.${i+10}`,ssh_password:'sealed',ssh_fingerprint:'trusted'}));
 for(const n of nodes){db.prepare('INSERT INTO nodes(id,name,token_hash,created,ssh_host,ssh_password,ssh_fingerprint) VALUES(?,?,?,?,?,?,?)').run(n.id,n.name,randomUUID(),1,n.ssh_host,n.ssh_password,n.ssh_fingerprint);if(mode==='shared')db.prepare('INSERT INTO settings VALUES(?,?)').run('forward_engine:'+n.id,JSON.stringify({mode,status:'success'}));}
 const ssh={busy:node=>[...jobs.values()].some(j=>j.node===node&&j.status==='running'),status:id=>{if(!jobs.has(id))throw Error('missing');return jobs.get(id);},runManaged(node,script,cb){const j={id:randomUUID(),node,status:'running',log:'',cb};jobs.set(j.id,j);submitted.push({node,script});return j;}};
 db.prepare('UPDATE nodes SET last_version=?').run('0.2.5');const f=createForwarding(db,ssh),source={id:randomUUID(),node_id:nodes[0].id,name:'现有规则',protocol:'both',listen_port:10161,target_host:'198.51.100.20',target_port:8443,state:'running',installed:true};db.prepare('INSERT INTO settings VALUES(?,?)').run('forwarding:'+source.id,JSON.stringify(source));
 const relay=createForwardRelay(db,f,ssh,()=>nodes),input=(rule=source.id)=>({node_id:nodes[1].id,host:nodes[1].ssh_host,listen_port:20161,expected:relay.fingerprint(f.list().find(r=>r.id===rule))});
 const finish=(status='success',log='FIREFLY_ENGINE_SHARED\nFIREFLY_FORWARD_ACTIVE')=>{const j=[...jobs.values()].at(-1);Object.assign(j,{status,log});j.cb?.(j);};
 return {db,f,relay,source,nodes,jobs,submitted,input,finish,close(){db.close();rmSync(dir,{recursive:true,force:true});}};
}
for(const mode of ['legacy','shared'])test(`经中转两步顺序、历史清零边界、路径标记与复用检查：${mode}`,()=>{const t=fixture(mode);try{
 t.db.prepare('INSERT INTO settings VALUES(?,?)').run('forward_day:'+t.source.id+':2026-10-29',JSON.stringify({rx:123,tx:456}));
 let p=t.relay.begin(t.source.id,t.input());assert.equal(t.submitted.length,1);assert.equal(t.submitted[0].node,t.nodes[1].id);assert.equal(t.f.list().find(r=>r.id===t.source.id).target_host,t.source.target_host);assert.equal(t.f.history(t.source.id).length,0);
 assert.throws(()=>t.relay.apply(p.id),e=>e.status===409);t.finish();p=t.relay.view(p.id);assert.equal(p.status,'relay_ready');assert.equal(t.submitted.length,1);assert.ok(t.db.prepare('SELECT value FROM settings WHERE key=?').get('forward_day:'+t.source.id+':2026-10-29'));
 assert.throws(()=>t.relay.begin(t.source.id,t.input()),e=>e.status===409);p=t.relay.apply(p.id);assert.equal(p.status,'entry_running');assert.equal(t.submitted[1].node,t.nodes[0].id);assert.throws(()=>t.relay.apply(p.id),e=>e.status===409);t.finish();p=t.relay.latest(t.f.list().find(r=>r.replaced_id===t.source.id).id);assert.equal(p.status,'success');const entry=t.f.list().find(r=>r.id===p.entry_id);assert.equal(entry.target_host,t.nodes[1].ssh_host);assert.equal(entry.target_port,20161);assert.equal(entry.listen_port,10161);assert.equal(entry.protocol,'both');assert.equal(t.db.prepare('SELECT value FROM settings WHERE key=?').get('forward_day:'+t.source.id+':2026-10-29'),undefined);assert.equal(t.relay.routes(t.f.list())[entry.id].relay,'中转B');assert.equal(t.relay.latest(entry.id).status,'success');
 // Editing a linked B must not continue showing the old C as a verified relationship.
 t.db.prepare('DELETE FROM settings WHERE key=?').run('forwarding:'+p.relay.id);assert.match(t.relay.routes(t.f.list())[entry.id].warning,/修改或删除/);
 }finally{t.close();}});
test('中转失败 / 重启中断 / 放弃均不修改入口；并发修改、同机、端口冲突和本机目标拒绝',()=>{const t=fixture();try{
 assert.throws(()=>t.relay.begin(t.source.id,{...t.input(),node_id:t.source.node_id}),/不能是入口/);assert.throws(()=>t.relay.begin(t.source.id,{...t.input(),expected:'old'}),e=>e.status===409);assert.throws(()=>t.relay.begin(t.source.id,{...t.input(),host:'127.0.0.1'}),/本机/);
 let p=t.relay.begin(t.source.id,t.input());t.finish('failed','connection refused');assert.equal(t.relay.view(p.id).status,'failed');assert.equal(t.f.list().find(r=>r.id===t.source.id).target_host,t.source.target_host);assert.equal(t.submitted.length,1);
 assert.throws(()=>t.relay.begin(t.source.id,t.input()),/端口已占用/);p=t.relay.begin(t.source.id,{...t.input(),listen_port:20162});t.finish();t.relay.view(p.id);t.f.action(t.source.id,'status');t.finish();assert.throws(()=>t.relay.apply(p.id),/入口规则已变化/);t.relay.cancel(p.id);
 p=t.relay.begin(t.source.id,{...t.input(),listen_port:20163});t.jobs.clear();assert.equal(t.relay.view(p.id).status,'interrupted');assert.equal(t.f.list().find(r=>r.id===t.source.id).target_host,t.source.target_host);
 p=t.relay.begin(t.source.id,{...t.input(),listen_port:20164});assert.equal(t.relay.cancel(p.id).status,'cancelled');t.finish();assert.equal(t.relay.view(p.id).status,'cancelled');assert.equal(t.f.list().find(r=>r.id===t.source.id).target_host,t.source.target_host);
 }finally{t.close();}});
test('复用 B 仅检查状态，不更新配置；B 后续修改阻止入口切换',()=>{const t=fixture();try{
 let p=t.relay.begin(t.source.id,t.input());t.finish();t.relay.cancel(p.id);p=t.relay.begin(t.source.id,t.input());assert.equal(p.reused,true);assert.equal(JSON.parse(Buffer.from(/json.loads\(base64.b64decode\('([^']+)'\)\)/.exec(t.submitted.at(-1).script)[1],'base64').toString()).action,'status');t.finish();t.relay.view(p.id);t.f.action(p.relay.id,'stop');t.finish('success','FIREFLY_FORWARD_STOPPED');assert.throws(()=>t.relay.apply(p.id),/中转规则已变化/);
 }finally{t.close();}});
test('入口部署失败保留中转及原入口配置，任务持久化且不自动重试',()=>{const t=fixture();try{
 let p=t.relay.begin(t.source.id,t.input());t.finish();t.relay.view(p.id);t.relay.apply(p.id);t.finish('failed','修改部署失败，正在尝试恢复原规则…');p=t.relay.view(p.id);assert.equal(p.status,'failed');assert.match(p.error,/核对入口日志/);assert.equal(t.f.list().find(r=>r.id===t.source.id).target_host,t.source.target_host);assert.ok(t.f.list().some(r=>r.id===p.relay.id&&r.state==='running'));const restored=createForwardRelay(t.db,t.f,{status(){throw Error();},busy:()=>false},()=>t.nodes);assert.equal(restored.latest(t.source.id).status,'failed');assert.equal(t.submitted.length,2);
 }finally{t.close();}});

function connect(t,rule=t.source.id,options={}){let p=t.relay.begin(rule,{...t.input(rule),expected:t.relay.fingerprint(t.f.list().find(r=>r.id===rule)),...options});t.finish();t.relay.view(p.id);t.relay.apply(p.id);t.finish();return t.relay.view(p.id);}
for(const mode of ['legacy','shared'])test(`已有中转可更换、取消、再次添加；原落地保留且不操作旧中转：${mode}`,()=>{const t=fixture(mode);try{
 let p=connect(t),entry=t.f.list().find(r=>r.id===p.entry_id),oldRelay=p.relay.id;
 const oldData=JSON.stringify({rx:123,tx:456});t.db.prepare('INSERT INTO settings VALUES(?,?)').run('forward_day:'+oldRelay+':2026-11-03',oldData);
 assert.equal(t.relay.connection(entry.id).target_host,t.source.target_host);
 assert.throws(()=>t.relay.begin(entry.id,{...t.input(entry.id),expected:t.relay.fingerprint(entry)}),/已使用/);
 p=connect(t,entry.id,{node_id:t.nodes[2].id,host:t.nodes[2].ssh_host,listen_port:30161});
 entry=t.f.list().find(r=>r.id===p.entry_id);assert.equal(entry.target_host,t.nodes[2].ssh_host);assert.equal(entry.listen_port,t.source.listen_port);assert.equal(p.relay.target_host,t.source.target_host);assert.equal(p.relay.target_port,t.source.target_port);
 assert.ok(t.f.list().find(r=>r.id===oldRelay&&r.state==='running'));assert.equal(t.db.prepare('SELECT value FROM settings WHERE key=?').get('forward_day:'+oldRelay+':2026-11-03').value,oldData);
 assert.equal(t.relay.routes(t.f.list())[entry.id].relay,'新中转D');assert.equal(t.relay.routes(t.f.list())[oldRelay],undefined);
 const count=t.submitted.length,newRelay=p.relay.id,direct=t.relay.direct(entry.id,{expected:t.relay.fingerprint(entry)});
 assert.equal(t.submitted.length,count+1);assert.equal(t.submitted.at(-1).node,t.nodes[0].id);assert.throws(()=>t.relay.direct(entry.id,{expected:t.relay.fingerprint(entry)}),e=>e.status===409);t.finish();p=t.relay.view(direct.id);assert.equal(p.status,'success');assert.equal(p.operation,'direct');
 entry=t.f.list().find(r=>r.id===p.entry_id);assert.equal(entry.target_host,t.source.target_host);assert.equal(entry.target_port,t.source.target_port);assert.equal(t.relay.connection(entry.id),null);assert.deepEqual(t.relay.routes(t.f.list()),{});assert.ok(t.f.list().find(r=>r.id===newRelay&&r.state==='running'));
 // A fresh manager resolves saved plans without the old completed job logs.
 const manager=createForwardRelay(t.db,t.f,{status(){throw Error('gone');},busy:()=>false},()=>t.nodes);assert.equal(manager.connection(entry.id),null);
 p=connect(t,entry.id,{listen_port:20161});assert.equal(p.reused,true);assert.equal(p.relay.target_host,t.source.target_host);assert.equal(t.relay.connection(p.entry_id).name,'中转B');
 }finally{t.close();}});

test('更换失败或放弃仍可恢复原落地；取消中转不依赖旧 B 在线或规则存在',()=>{const t=fixture('shared');try{
 let p=connect(t),entry=t.f.list().find(r=>r.id===p.entry_id);
 assert.throws(()=>t.relay.direct(entry.id,{expected:'stale'}),e=>e.status===409);
 let next=t.relay.begin(entry.id,{node_id:t.nodes[2].id,host:t.nodes[2].ssh_host,listen_port:30161,expected:t.relay.fingerprint(entry)});t.finish('failed','new relay offline');assert.equal(t.relay.view(next.id).status,'failed');assert.equal(t.relay.connection(entry.id).name,'中转B');
 // A failed A redeployment leaves the old saved relationship usable for a retry.
 let direct=t.relay.direct(entry.id,{expected:t.relay.fingerprint(entry)});t.finish('failed','rollback original');assert.equal(t.relay.view(direct.id).status,'failed');entry=t.f.list().find(r=>r.id===entry.id);assert.equal(t.relay.connection(entry.id).target_host,t.source.target_host);
 // Cleanup of a failed edit is normally completed by retrying the same A update.
 t.db.prepare('DELETE FROM settings WHERE key=?').run('forwarding:'+p.relay.id);t.nodes[1].enabled=0;t.nodes[1].ssh_password='';
 direct=t.relay.direct(entry.id,{expected:t.relay.fingerprint(entry)});t.finish();p=t.relay.view(direct.id);assert.equal(p.status,'success');assert.equal(t.f.list().find(r=>r.id===p.entry_id).target_host,t.source.target_host);
 assert.throws(()=>t.relay.direct(p.entry_id,{expected:t.relay.fingerprint(t.f.list().find(r=>r.id===p.entry_id))}),/未找到/);
 }finally{t.close();}});

test('同一 B 可换端口；等待切换时不能同时取消中转，放弃后原链路仍可管理',()=>{const t=fixture('shared');try{
 let p=connect(t),entry=t.f.list().find(r=>r.id===p.entry_id),next=t.relay.begin(entry.id,{...t.input(entry.id),listen_port:20162,expected:t.relay.fingerprint(entry)});assert.equal(next.relay.target_host,t.source.target_host);t.finish();t.relay.view(next.id);
 assert.throws(()=>t.relay.direct(entry.id,{expected:t.relay.fingerprint(t.f.list().find(r=>r.id===entry.id))}),/已有中转任务/);t.relay.cancel(next.id);assert.equal(t.relay.connection(entry.id).plan_id,p.id);
 next=t.relay.begin(entry.id,{...t.input(entry.id),listen_port:20162,expected:t.relay.fingerprint(t.f.list().find(r=>r.id===entry.id))});assert.equal(next.reused,true);t.finish();t.relay.view(next.id);t.relay.apply(next.id);t.finish();p=t.relay.view(next.id);assert.equal(t.relay.connection(p.entry_id).listen_port,20162);assert.equal(t.relay.connection(p.entry_id).target_host,t.source.target_host);
 }finally{t.close();}});
test('中转接口认证 / CSRF / 私有隔离及任务输入校验',async()=>{const dir=mkdtempSync(join(tmpdir(),'relay-api-')),app=await createApp({password:'relay-api-password',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,id=randomUUID(),headers={'Content-Type':'application/json'},call=(path,method='GET',body)=>fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});try{
 assert.equal((await call('/api/forwarding/relay?rule='+id)).status,401);assert.equal((await call('/api/forwarding/relay/'+id)).status,401);assert.equal((await call('/api/forwarding/'+id+'/relay/direct','POST',{})).status,401);const login=await call('/admin/api/login','POST',{username:'admin',password:'relay-api-password'}),session=await login.json();headers.Cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await call('/api/forwarding/'+id+'/relay','POST',{})).status,403);assert.equal((await call('/api/forwarding/'+id+'/relay/direct','POST',{})).status,403);headers['X-CSRF-Token']=session.csrf;assert.equal((await call('/api/forwarding/'+id+'/relay','POST',null)).status,400);assert.equal((await call('/api/forwarding/'+id+'/relay/direct','POST',null)).status,400);assert.equal((await call('/api/forwarding/'+id+'/relay/direct','POST',{})).status,404);assert.equal((await call('/api/forwarding/relay/'+id+'/apply','POST',{})).status,404);assert.deepEqual(await(await call('/api/forwarding/relay?rule='+id)).json(),{plan:null,connection:null});
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}});
