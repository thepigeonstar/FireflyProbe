import test from 'node:test';import assert from 'node:assert/strict';import {createForwardBatch} from '../server/forward-batch.mjs';
test('转发批量队列逐条执行，区分安装更新，跳过缺少 SSH，失败后继续',async()=>{
 const jobs=new Map(),started=[],rules=[{id:'a',node_id:'one',name:'A',installed:false},{id:'b',node_id:'one',name:'B',installed:true},{id:'c',node_id:'two',name:'C'},{id:'d',node_id:'one',name:'D'}],base={enabled:1,ssh_host:'host',ssh_password:'sealed',ssh_fingerprint:'trusted'};
 const forwarding={list:()=>rules,action(id,action){assert.equal(action,'start');started.push(id);const job={id,status:'running',log:''};jobs.set(id,job);return job;}};
 const queue=createForwardBatch(forwarding,{busy:()=>false,status:id=>jobs.get(id)},()=>[{...base,id:'one',name:'服务器一'},{...base,id:'two',name:'服务器二',ssh_password:''}]);
 try{const batch=queue.start();assert.deepEqual(started,['a']);assert.equal(batch.items[0].operation,'安装');assert.equal(batch.items[1].operation,'更新');assert.equal(batch.items[2].status,'skipped');assert.throws(()=>queue.start(),e=>e.status===409);jobs.get('a').status='failed';jobs.get('a').log='SSH 连接失败';await new Promise(r=>setTimeout(r,1100));assert.deepEqual(started,['a','b']);jobs.get('b').status='success';await new Promise(r=>setTimeout(r,1100));assert.deepEqual(started,['a','b','d']);jobs.get('d').status='success';await new Promise(r=>setTimeout(r,1100));assert.equal(queue.view().status,'complete');assert.equal(queue.view().items[0].message,'SSH 连接失败');assert.throws(()=>queue.start('missing'),e=>e.status===404);}
 finally{queue.cancel();}
});
test('指定服务器范围、忙时等待，以及主控停止后不继续启动后续规则',async()=>{
 let busy=true,started=[];const forwarding={list:()=>[{id:'a',node_id:'one'},{id:'b',node_id:'two'}],action(id){started.push(id);return {id,status:'running'};}};
 const queue=createForwardBatch(forwarding,{busy:()=>busy,status:id=>({id,status:'success',log:'完成'})},()=>['one','two'].map(id=>({id,enabled:1,ssh_host:'host',ssh_password:'sealed',ssh_fingerprint:'trusted'})));
 try{assert.equal(queue.start('one').items.length,1);assert.deepEqual(started,[]);busy=false;await new Promise(r=>setTimeout(r,1100));assert.deepEqual(started,['a']);queue.cancel();assert.equal(queue.view().status,'interrupted');assert.throws(()=>queue.start(),e=>e.status===503);}
 finally{queue.cancel();}
});
