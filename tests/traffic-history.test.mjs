import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/main.mjs';
import {dayKey} from '../server/store.mjs';
test('流量历史仅管理员可看，按日/月汇总、排除停用节点、范围校验',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'traffic-history-')),app=await createApp({password:'history-admin-password',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{assert.equal((await fetch(base+'/api/traffic/history')).status,401);assert.equal((await fetch(base+'/api/public/traffic/history')).status,401);
 const login=await fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'history-admin-password'})}),data=await login.json(),headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':data.csrf};
 const add=async(name,enabled)=>{const r=await fetch(base+'/api/nodes',{method:'POST',headers,body:JSON.stringify({name,enabled})});return (await r.json()).id;};const a=await add('A',true),b=await add('B',true),c=await add('disabled',false),today=dayKey(new Date(),'Asia/Shanghai'),old=new Date(Date.parse(today)-40*864e5).toISOString().slice(0,10);
 const put=app.db.prepare('INSERT INTO daily VALUES(?,?,?,?,?)');put.run(a,'eth0',today,10,20);put.run(a,'eth1',today,5,8);put.run(b,'eth0',today,30,40);put.run(c,'eth0',today,1000,1000);put.run(a,'eth0',old,7,9);
 const get=async(query)=>{const r=await fetch(base+'/api/traffic/history?'+query,{headers});return {status:r.status,data:await r.json()};};
 let r=await get('days=15');assert.equal(r.status,200);assert.equal(r.data.rows.length,1);assert.equal(r.data.rows[0].rx,45);assert.equal(r.data.rows[0].tx,68);
 r=await get('node='+a+'&days=60');assert.equal(r.data.rows.length,2);assert.equal(r.data.rows[0].rx,15);r=await get('period=monthly');assert.equal(r.data.rows.reduce((s,x)=>s+x.rx,0),52);assert.ok(r.data.rows.every(x=>/^\d{4}-\d{2}$/.test(x.date)));
 assert.equal((await get('days=16')).status,400);assert.equal((await get('period=invalid')).status,400);assert.equal((await get('node=missing')).status,404);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
