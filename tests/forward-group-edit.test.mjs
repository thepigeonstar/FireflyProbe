import test from 'node:test';import assert from 'node:assert/strict';
import {groupEditPlan} from '../server/forward-group-edit.mjs';import {createForwardBatch} from '../server/forward-batch.mjs';
import {createApp} from '../server/main.mjs';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
const fields={name:'统一规则',protocol:'both',listen_port:1443,target_host:'192.0.2.4',target_port:443};
function fixture(){const base={enabled:1,ssh_host:'192.0.2.1',ssh_password:'sealed',ssh_fingerprint:'trusted'};const nodes=['a','b','c','d','outside'].map(id=>({...base,id,name:id})),groups=[{id:'g',name:'同组',node_ids:['a','b','c','d']}],rules=['a','b','outside'].map(node_id=>({id:'rule-'+node_id,node_id,name:'旧规则',protocol:'tcp',listen_port:443,target_host:'192.0.2.8',target_port:80,installed:false,state:'not_deployed'}));return {nodes,groups,rules};}
test('同组按旧端口协议匹配：缺失不新增，冲突/SSH/任务跳过，禁止跨组',()=>{
 const {nodes,groups,rules}=fixture(),f={list:()=>rules};
 let plan=groupEditPlan(f,nodes,groups,'rule-a',{group_id:'g',fields});assert.deepEqual(plan.items.map(i=>i.status),['queued','queued','skipped','skipped']);assert.equal(rules.length,3);assert.ok(!plan.items.some(i=>i.node_id==='outside'));
 rules.push({...rules[1],id:'conflict',listen_port:1443});plan=groupEditPlan(f,nodes,groups,'rule-a',{group_id:'g',fields});assert.match(plan.items[1].message,/冲突/);rules.pop();
 rules[1].installed=true;rules[1].state='running';nodes[1].ssh_password='';assert.match(groupEditPlan(f,nodes,groups,'rule-a',{group_id:'g',fields}).items[1].message,/SSH/);
 assert.throws(()=>groupEditPlan(f,nodes,groups,'rule-outside',{group_id:'g',fields}),e=>e.status===400);
 assert.throws(()=>groupEditPlan(f,nodes,groups,'rule-a',{group_id:'ungrouped',fields}),e=>e.status===400);
});
test('预览确认绑定字段和完整分组，草稿仅保存，陈旧请求和队列互斥',()=>{
 const {nodes,groups,rules}=fixture(),calls=[],f={list:()=>rules,update(id,data){calls.push(id);Object.assign(rules.find(r=>r.id===id),data);return {saved:true,id};}},queue=createForwardBatch(f,{busy:()=>false},()=>nodes,()=>groups);
 try{const input={group_id:'g',fields},preview=queue.previewGroupEdit('rule-a',input);assert.equal(calls.length,0);assert.throws(()=>queue.startGroupEdit('rule-a',{...input,expected:'wrong'}),e=>e.status===409);assert.throws(()=>queue.startGroupEdit('rule-a',{...input,fields:{...fields,target_port:8443},expected:preview.expected}),e=>e.status===409);
 const member=groups[0].node_ids.pop();assert.throws(()=>queue.startGroupEdit('rule-a',{...input,expected:preview.expected}),e=>e.status===409);groups[0].node_ids.push(member);
 const result=queue.startGroupEdit('rule-a',{...input,expected:preview.expected});assert.equal(result.status,'complete');assert.deepEqual(calls,['rule-a','rule-b']);assert.equal(result.items.filter(i=>i.status==='success').length,2);assert.equal(rules.find(r=>r.node_id==='outside').target_port,80);
 }finally{queue.cancel();}
});
test('已部署同组编辑逐台执行：失败继续、运行期间互斥、执行前拒绝规则变化',async()=>{
 const {nodes,groups,rules}=fixture();for(const r of rules){r.installed=true;r.state='running';}const calls=[],jobs=new Map(),f={list:()=>rules,update(id){calls.push(id);const j={id,status:'running',log:'部署中'};jobs.set(id,j);return j;}},queue=createForwardBatch(f,{busy:()=>false,status:id=>jobs.get(id)},()=>nodes,()=>groups);
 try{const input={group_id:'g',fields},p=queue.previewGroupEdit('rule-a',input);queue.startGroupEdit('rule-a',{...input,expected:p.expected});assert.deepEqual(calls,['rule-a']);assert.throws(()=>queue.start(),e=>e.status===409);assert.throws(()=>queue.startGroupEdit('rule-a',{...input,expected:p.expected}),e=>e.status===409);jobs.get('rule-a').status='failed';await new Promise(r=>setTimeout(r,1100));assert.deepEqual(calls,['rule-a','rule-b']);jobs.get('rule-b').status='success';await new Promise(r=>setTimeout(r,1100));assert.equal(queue.view().status,'complete');assert.deepEqual(queue.view().items.slice(0,2).map(i=>i.status),['failed','success']);
 }finally{queue.cancel();}
 let busy=true;const changed=createForwardBatch(f,{busy:()=>busy,status:id=>jobs.get(id)},()=>nodes,()=>groups);try{const input={group_id:'g',fields},p=changed.previewGroupEdit('rule-a',input);changed.startGroupEdit('rule-a',{...input,expected:p.expected});rules[0].target_port=81;busy=false;await new Promise(r=>setTimeout(r,1100));assert.equal(changed.view().items[0].status,'failed');assert.match(changed.view().items[0].message,/规则已变化/);}finally{changed.cancel();}
});
test('同组同步API认证/CSRF、真实草稿更新、SSH地址仅管理员可见',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'group-edit-api-')),app=await createApp({dbPath:join(dir,'db.sqlite'),username:'admin',password:'group-edit-pass',disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port,headers={'Content-Type':'application/json'},call=(path,method='GET',data)=>fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 try{
  assert.equal((await call('/api/forwarding/00000000-0000-0000-0000-000000000000/group-edit','POST',{})).status,401);
  const login=await call('/admin/api/login','POST',{username:'admin',password:'group-edit-pass'}),session=await login.json();headers.Cookie=login.headers.get('set-cookie').split(';')[0];headers['X-CSRF-Token']=session.csrf;
  const nodes=[];for(const name of ['a','b','outside']){const n=await(await call('/api/nodes','POST',{name})).json();app.db.prepare("UPDATE nodes SET ssh_host='192.0.2.77',ssh_password='sealed',ssh_fingerprint='trusted' WHERE id=?").run(n.id);nodes.push(n);}
  const rules=[];for(const n of nodes)rules.push(await(await call('/api/forwarding','POST',{node_id:n.id,name:'draft',protocol:'tcp',listen_port:443,target_host:'192.0.2.8',target_port:80})).json());
  const group=await(await call('/api/forwarding/groups','POST',{name:'测试分组',node_ids:nodes.slice(0,2).map(n=>n.id)})).json(),path='/api/forwarding/'+rules[0].id+'/group-edit',input={group_id:group.id,fields};
  delete headers['X-CSRF-Token'];assert.equal((await call(path,'POST',{...input,preview:true})).status,403);headers['X-CSRF-Token']=session.csrf;
  const preview=await call(path,'POST',{...input,preview:true});assert.equal(preview.status,200);const plan=await preview.json();assert.equal(plan.items.length,2);assert.equal(plan.items[1].host,'192.0.2.77');
  assert.equal((await call(path,'POST',{...input,expected:'stale'})).status,409);
  const response=await call(path,'POST',{...input,expected:plan.expected});assert.equal(response.status,202);const result=await response.json();assert.equal(result.status,'complete');assert.equal(result.items.filter(i=>i.status==='success').length,2);
  const list=await(await call('/api/forwarding')).json();assert.equal(list.rules.find(r=>r.id===rules[1].id).target_port,443);assert.equal(list.rules.find(r=>r.id===rules[2].id).target_port,80);assert.equal(list.nodes[0].ssh_host,'192.0.2.77');
  const pub=await fetch(base+'/api/public');assert.ok(!(await pub.text()).includes('192.0.2.77'));
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
