import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';
test('系统信息接收、重启后保留、公开权限及节点删除清理',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'system-info-')),options={password:'system-info-test-2026',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true};let app;
 try{
  app=await createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+app.server.address().port;
  async function login(){const r=await fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:options.password})});const s=await r.json();return {'Content-Type':'application/json',Cookie:r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf};}
  let headers=await login();const created=await fetch(base+'/api/nodes',{method:'POST',headers,body:JSON.stringify({name:'system node',public_visible:true})});const node=await created.json();
  const r=await fetch(base+'/api/agent/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+node.token},body:JSON.stringify({version:'0.2.1',interface:'eth0',system:'Debian GNU/Linux 11 (bullseye)',rx_speed:0,tx_speed:0,cpu:1,mem_total:100,mem_used:10,disk_total:100,disk_used:10,uptime:10})});assert.equal(r.status,200,await r.text());assert.equal(app.snapshot()[0].system,'Debian GNU/Linux 11 (bullseye)');
  await app.close();app=await createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;headers=await login();assert.equal(app.snapshot()[0].system,'Debian GNU/Linux 11 (bullseye)');
  await fetch(base+'/api/settings',{method:'PUT',headers,body:JSON.stringify({public_enabled:true,public_show_metrics:false})});const pub=await fetch(base+'/api/public');assert.equal(pub.status,200);assert.ok(!(await pub.json()).nodes[0].system);
  const settingsResponse=await fetch(base+'/api/settings',{method:'PUT',headers,body:JSON.stringify({public_show_system:true})});assert.equal(settingsResponse.status,200);const allowed=await fetch(base+'/api/public');assert.equal((await allowed.json()).nodes[0].system,'Debian GNU/Linux 11 (bullseye)');
  assert.equal((await fetch(base+'/api/nodes/'+node.id,{method:'DELETE',headers})).status,200);assert.equal(app.db.prepare('SELECT value FROM settings WHERE key=?').get('node_system:'+node.id),undefined);
 }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
