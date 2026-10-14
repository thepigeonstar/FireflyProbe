import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {openStore} from '../server/store.mjs';
import {createForwarding} from '../server/forwarding.mjs';
test('转发汇总跨服务器、包含停止规则，按主控时区划日，不把月历史算作日流量',()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-summary-')),db=openStore(join(dir,'db.sqlite'));
 const put=(key,value)=>db.prepare('INSERT INTO settings VALUES(?,?)').run(key,JSON.stringify(value));
 try{
  put('forwarding:a',{id:'a',node_id:'server-a',state:'running'});put('forwarding:b',{id:'b',node_id:'server-b',state:'stopped'});
  put('forward_day:a:2026-10-14',{rx:100,tx:200});put('forward_day:b:2026-10-14',{rx:300,tx:400});
  put('forward_day:a:2026-10-13',{rx:10,tx:20});put('forward_day:b:2026-10-13',{rx:30,tx:40});
  put('forward_month:a:2026-10',{rx:999999,tx:999999});put('forward_day:deleted:2026-10-14',{rx:999,tx:999});
  const f=createForwarding(db,{},()=> 'Asia/Shanghai');
  const result=f.summary(new Date('2026-10-13T16:00:00Z'));
  assert.deepEqual(result,{timezone:'Asia/Shanghai',rule_count:2,today:{date:'2026-10-14',rx:400,tx:600,total:1000},yesterday:{date:'2026-10-13',rx:40,tx:60,total:100}});
  assert.equal(f.summary(new Date('2026-10-13T15:59:59Z')).today.total,100);
  assert.equal(f.summary(new Date('2026-11-01T00:00:00Z')).today.total,0);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('夏令时结束日的昨日使用前一日历日期',()=>{
 const dir=mkdtempSync(join(tmpdir(),'forward-summary-dst-')),db=openStore(join(dir,'db.sqlite'));
 try{const f=createForwarding(db,{},()=> 'America/New_York');const result=f.summary(new Date('2026-11-02T04:30:00Z'));assert.equal(result.today.date,'2026-11-01');assert.equal(result.yesterday.date,'2026-10-31');}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
