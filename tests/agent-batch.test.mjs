import test from 'node:test';import assert from 'node:assert/strict';import {createAgentBatch} from '../server/agent-batch.mjs';
test('全部更新依次逐台执行，实时日志、跳过原因及失败后继续',async()=>{
 const jobs=new Map(),started=[],base={enabled:1,last_version:'0.2.0',ssh_host:'127.0.0.1',ssh_password:'sealed',ssh_fingerprint:'confirmed'};
 const ssh={deploy(id){started.push(id);const job={id,node_id:id,status:'running',log:''};jobs.set(id,job);return job;},status(id){return jobs.get(id);}};
 const batch=createAgentBatch(ssh,()=>[...['a','b','c'].map(id=>({...base,id,name:id})),{...base,id:'d',ssh_password:''},{...base,id:'e',last_version:''}]);
 try{batch.start();assert.deepEqual(started,['a']);assert.equal(batch.view().items.filter(i=>i.status==='skipped').length,2);assert.throws(()=>batch.start());jobs.get('a').log='正在安装依赖';await new Promise(r=>setTimeout(r,1100));assert.equal(batch.view().items.find(i=>i.id==='a').message,'正在安装依赖');assert.deepEqual(started,['a']);jobs.get('a').status='success';await new Promise(r=>setTimeout(r,1100));assert.deepEqual(started,['a','b']);jobs.get('b').status='failed';jobs.get('b').log='密码错误';await new Promise(r=>setTimeout(r,1100));assert.deepEqual(started,['a','b','c']);jobs.get('c').status='success';await new Promise(r=>setTimeout(r,1100));assert.equal(batch.view().status,'complete');assert.equal(batch.view().items.filter(i=>i.status==='success').length,2);assert.deepEqual(batch.view().items.filter(i=>i.status==='failed').map(i=>i.id),['b']);assert.equal(batch.view().items.find(i=>i.id==='b').message,'密码错误');}
 finally{batch.cancel();}
});
