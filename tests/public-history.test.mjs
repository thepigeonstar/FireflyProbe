import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';

test('公开24小时网速：只聚合公开启用节点、先求节点均值、私有与关闭时不可访问',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-public-history-')),app=await createApp({password:'public-history-test-2026',dbPath:join(dir,'db.sqlite'),disableTelegram:true});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
  const call=async(path,method='GET',body,anonymous=false)=>{const response=await fetch(base+path,{method,headers:anonymous?{}:headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),response};};
  try{
    assert.equal((await call('/api/public/history')).status,404);assert.equal((await call('/api/network/history')).status,401);assert.equal((await call('/api/nodes/00000000-0000-0000-0000-000000000000/network-history')).status,401);
    const login=await call('/api/login','POST',{username:'admin',password:'public-history-test-2026'});headers={...headers,Cookie:login.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.body.csrf};
    const create=async(name,visible,enabled=true)=>(await call('/api/nodes','POST',{name,public_visible:visible,enabled})).body;
    const a=await create('公开甲',true),b=await create('公开乙',true),hidden=await create('隐藏机器',false),disabled=await create('已停用',true,false);
    const minute=Math.floor(Date.now()/60000)*60-120,insert=app.db.prepare('INSERT INTO minutes VALUES(?,?,?,?,?,?,?)');insert.run(a.id,minute,100,200,99,99,2);insert.run(b.id,minute,90,45,99,99,3);insert.run(hidden.id,minute,1000000,1000000,99,99,1);insert.run(disabled.id,minute,111,222,99,99,1);insert.run(a.id,minute-86400,1,2,99,99,1);
    await call('/api/settings','PUT',{public_enabled:true,public_show_metrics:true});
    const total=(await call('/api/public/history','GET',undefined,true)).body;assert.equal(total.minutes,undefined);assert.equal(total.peak,195);assert.match(total.chart_svg,/<svg/);assert.equal(total.hours,24);
    assert.equal((await call('/api/public/nodes/'+hidden.id+'/history','GET',undefined,true)).status,404);const perNode=(await call('/api/public/nodes/'+a.id+'/history','GET',undefined,true)).body;assert.equal(perNode.name,'公开甲');assert.equal(perNode.minutes,undefined);assert.equal(perNode.peak,150);assert.equal((await call('/api/nodes/'+a.id+'/network-history')).body.minutes[0].rx,50);assert.equal(perNode.ssh_host,undefined);assert.equal(perNode.daily,undefined);
    const admin=(await call('/api/network/history')).body;assert.equal(admin.minutes[0].rx,1000080);assert.equal(admin.minutes[0].tx,1000115);
    const current=Math.floor(Date.now()/60000)*60;insert.run(b.id,current,1000,2000,99,99,2);const live=await fetch(base+'/api/agent/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+b.token},body:JSON.stringify({hostname:'fixture',interface:'eth0',rx_speed:7,tx_speed:11,cpu:1,mem_total:100,mem_used:1,disk_total:100,disk_used:1,uptime:1})});assert.equal(live.status,200);const liveHistory=(await call('/api/nodes/'+b.id+'/network-history')).body.minutes.find(row=>row.minute===current);assert.equal(liveHistory.rx,7);assert.equal(liveHistory.tx,11);const realtime=(await call('/api/public','GET',undefined,true)).body.network;assert.equal(realtime.rx,7);assert.equal(realtime.tx,11);
    const page=await fetch(base+'/public/network');const html=await page.text();assert.equal(page.status,200);assert.ok(!html.includes('管理员登录'));assert.equal((await fetch(base+'/public/servers/'+a.id)).status,200);
    await call('/api/nodes/'+a.id,'PUT',{public_visible:false});assert.equal((await call('/api/public/nodes/'+a.id+'/history','GET',undefined,true)).status,404);assert.equal((await call('/api/public/history','GET',undefined,true)).body.peak,45);
    await call('/api/settings','PUT',{public_show_metrics:false});assert.equal((await call('/api/public/history','GET',undefined,true)).status,404);assert.equal((await call('/api/public/nodes/'+b.id+'/history','GET',undefined,true)).status,404);assert.equal((await call('/api/public','GET',undefined,true)).body.network,undefined);assert.equal((await call('/api/network/history')).status,200);
    await call('/api/settings','PUT',{public_enabled:false});assert.equal((await call('/api/public/history','GET',undefined,true)).status,404);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
