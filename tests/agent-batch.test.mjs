import test from 'node:test';import assert from 'node:assert/strict';import {createAgentBatch} from '../server/agent-batch.mjs';
test('全部更新最多并行两台，跳过未配置和未接入节点，记录成功失败',async()=>{
 const jobs=new Map(),started=[],base={enabled:1,last_version:'0.2.0',ssh_host:'127.0.0.1',ssh_password:'sealed',ssh_fingerprint:'confirmed'};
 const ssh={deploy(id){started.push(id);const job={id,node_id:id,status:'running',log:''};jobs.set(id,job);return job;},status(id){return jobs.get(id);}};
 const batch=createAgentBatch(ssh,()=>[...['a','b','c'].map(id=>({...base,id,name:id})),{...base,id:'d',ssh_password:''},{...base,id:'e',last_version:''}]);
 try{batch.start();assert.deepEqual(started,['a','b']);assert.equal(batch.view().items.filter(i=>i.status==='skipped').length,2);assert.throws(()=>batch.start());jobs.get('a').status='success';jobs.get('b').status='failed';await new Promise(r=>setTimeout(r,1100));assert.deepEqual(started,['a','b','c']);jobs.get('c').status='success';await new Promise(r=>setTimeout(r,1100));assert.equal(batch.view().status,'complete');assert.equal(batch.view().items.filter(i=>i.status==='success').length,2);assert.equal(batch.view().items.filter(i=>i.status==='failed').length,1);}
 finally{batch.cancel();}
});
