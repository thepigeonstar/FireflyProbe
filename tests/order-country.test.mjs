import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp,publicIP,reportIP} from '../server/main.mjs';

test('国家识别使用公网地址，仅受信本地代理读取转发地址',()=>{
 for(const ip of ['127.0.0.1','10.2.3.4','172.20.0.1','192.168.1.1','169.254.2.1','100.64.0.1','::1','fc00::1','fe80::1','garbage'])assert.equal(publicIP(ip),'');
 assert.equal(publicIP('::ffff:8.8.8.8'),'8.8.8.8');assert.equal(publicIP('2606:4700::1111'),'2606:4700::1111');
 assert.equal(reportIP({socket:{remoteAddress:'8.8.8.8'},headers:{'x-forwarded-for':'1.1.1.1'}},{}),'8.8.8.8');
 assert.equal(reportIP({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'9.9.9.9, 1.1.1.1'}},{}),'1.1.1.1');
});
test('拖拽排序原子保存、校验完整列表、配置保持顺序；国旗异步缓存且公开不泄露 IP',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'firefly-order-'));let lookups=0;
 const app=await createApp({password:'order-country-test-2026',dbPath:join(dir,'db.sqlite'),disableTelegram:true,countryLookup:async ip=>{lookups++;assert.equal(ip,'8.8.8.8');return {country:'US'};}});
 await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
 const call=async(path,method='GET',body,custom)=>{const r=await fetch(base+path,{method,headers:custom||headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json(),r};};
 try{
  assert.equal((await call('/api/nodes/order','PUT',{ids:[]})).status,401);const login=await call('/admin/api/login','POST',{username:'admin',password:'order-country-test-2026'});headers={...headers,Cookie:login.r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.body.csrf};
  const a=(await call('/api/nodes','POST',{name:'A',public_visible:true})).body,b=(await call('/api/nodes','POST',{name:'B',public_visible:true})).body;
  const ids=[b.id,a.id];assert.equal((await call('/api/nodes/order','PUT',{ids},{Cookie:headers.Cookie,'Content-Type':'application/json'})).status,403);
  assert.equal((await call('/api/nodes/order','PUT',{ids:[a.id,a.id]})).status,409);assert.equal((await call('/api/nodes/order','PUT',{ids:[a.id]})).status,409);assert.equal((await call('/api/nodes/order','PUT',{ids})).status,200);
  await call('/api/nodes/'+a.id,'PUT',{name:'A2'});assert.deepEqual((await call('/api/nodes')).body.nodes.map(n=>n.id),ids);
  await call('/api/settings','PUT',{public_enabled:true,public_show_metrics:true});
  const report={interface:'eth0',hostname:'fixture',rx_speed:0,tx_speed:0,cpu:1,mem_total:100,mem_used:10,disk_total:100,disk_used:10,uptime:90061};
  assert.equal((await call('/api/agent/report','POST',report,{'Content-Type':'application/json',Authorization:'Bearer '+a.token,'X-Forwarded-For':'8.8.8.8'})).status,200);
  for(let i=0;i<30&&!app.snapshot().find(n=>n.id===a.id).country_code;i++)await new Promise(r=>setTimeout(r,10));
  assert.equal(app.snapshot().find(n=>n.id===a.id).country_code,'US');assert.equal(lookups,1);const data=(await call('/api/public')).body;assert.deepEqual(data.nodes.map(n=>n.id),ids);assert.equal(data.nodes[1].metrics.uptime,90061);assert.equal(data.nodes[1].country_code,'US');assert.ok(!JSON.stringify(data).includes('8.8.8.8'));assert.ok(!Object.hasOwn(app.snapshot()[1],'country_ip'));
  assert.equal((await fetch(base+'/flags/us.svg')).status,200);assert.equal((await fetch(base+'/flags/LICENSE')).status,404);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
