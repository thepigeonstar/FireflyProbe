import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { createApp } from '../server/main.mjs';
import { dayKey } from '../server/store.mjs';

test('完整 API：认证、幂等流量、网卡锁定、通知、50 台上报与重启持久化',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'lightprobe-test-'));
  const options={password:'integration-test-password-2026',dbPath:join(dir,'test.sqlite'),disableTelegram:true};
  let app=await createApp(options),cookie='',csrf='';
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  let base='http://127.0.0.1:'+app.server.address().port;
  const call=async(path,{method='GET',data,secret,admin=true,csrfOverride}={})=>{
    const headers={'Content-Type':'application/json'};
    if(admin&&cookie){headers.Cookie=cookie;headers['X-CSRF-Token']=csrfOverride??csrf;}
    if(secret)headers.Authorization='Bearer '+secret;
    const r=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
    return {status:r.status,data:await r.json(),headers:r.headers};
  };
  const report=(overrides={})=>({version:'test',hostname:'test-node',interface:'eth0',interfaces:['eth0','lo'],rx_speed:1024,tx_speed:2048,cpu:12.5,mem_total:1024**3,mem_used:512*1024**2,disk_total:20*1024**3,disk_used:5*1024**3,uptime:100,...overrides});
  try{
    await t.test('拒绝未登录、错误密码、错误密钥和 CSRF',async()=>{
      assert.equal((await call('/api/nodes',{admin:false})).status,401);
      assert.equal((await call('/api/login',{method:'POST',data:{username:'admin',password:'wrong'}})).status,401);
      const login=await call('/api/login',{method:'POST',data:{username:'admin',password:options.password}});
      assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
      assert.equal((await call('/api/nodes',{method:'POST',csrfOverride:'wrong',data:{name:'no'}})).status,403);
      assert.equal((await call('/api/agent/config',{admin:false,secret:'a'.repeat(64)})).status,401);
    });
    const today=dayKey(new Date(),'Asia/Shanghai');
    const created=await call('/api/nodes',{method:'POST',data:{name:'香港 01',group_name:'亚太',quota:10000,billing_mode:'sum'}});
    const id=created.data.id,secret=created.data.token;
    assert.equal(created.status,201);
    await t.test('接受首次采样，持久化历史，重复同步不累计',async()=>{
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report({days:[{date:today,rx:1000,tx:2000}],history_timezone:'Asia/Shanghai'})})).status,200);
      let nodes=await call('/api/nodes');assert.equal(nodes.data.nodes[0].traffic.measured,3000);assert.equal(nodes.data.nodes[0].interface,'eth0');assert.equal(nodes.data.nodes[0].status,'online');
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report()})).status,429);
      await new Promise(r=>setTimeout(r,2100));
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report({days:[{date:today,rx:1000,tx:2000}],history_timezone:'Asia/Shanghai'})})).status,200);
      nodes=await call('/api/nodes');assert.equal(nodes.data.nodes[0].traffic.measured,3000);
      assert.equal((await call('/api/nodes/'+id,{method:'PUT',data:{name:'test',interface:'ens3'}})).status,409);
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report({interface:'ens3'})})).status,409);
    });
    await t.test('无效采样不会写入历史，时区不一致拒收日流量',async()=>{
      await new Promise(r=>setTimeout(r,2100));
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report({cpu:101})})).status,400);
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report({days:[{date:'2026-02-30',rx:1,tx:1}],history_timezone:'Asia/Shanghai'})})).status,400);
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret,data:report({days:[{date:today,rx:9000,tx:9000}],history_timezone:'UTC'})})).status,200);
      const nodes=await call('/api/nodes');assert.equal(nodes.data.nodes[0].traffic.measured,3000);assert.match(nodes.data.nodes[0].history_error,/时区/);
    });
    await t.test('设置验证、管理员读取已保存 Token、总览不含 Token、额度通知去重',async()=>{
      assert.equal((await call('/api/settings',{method:'PUT',data:{interval:60,offline_seconds:45}})).status,400);
      assert.equal((await call('/api/settings',{method:'PUT',data:{timezone:'UTC'}})).status,400);
      const settings=await call('/api/settings',{method:'PUT',data:{telegram_token:'123456789:TEST_TOKEN_NOT_REAL',telegram_chat:'-100123456',thresholds:[20],report_enabled:false}});
      assert.equal(settings.status,200);assert.equal(settings.data.telegram_token,'123456789:TEST_TOKEN_NOT_REAL');assert.equal(settings.data.telegram_configured,true);
      assert.equal((await call('/api/settings')).data.telegram_token,'123456789:TEST_TOKEN_NOT_REAL');
      assert.equal((await call('/api/nodes')).data.settings.telegram_token,undefined);
      assert.equal((await call('/api/settings',{admin:false})).status,401);
      app.db.prepare("UPDATE nodes SET history_error='',history_timezone='Asia/Shanghai' WHERE id=?").run(id);
      await app.notifications();await app.notifications();
      assert.equal(app.db.prepare("SELECT COUNT(*) n FROM outbox WHERE event_key LIKE 'quota:%'").get().n,1);
      assert.equal((await call('/api/notifications/test',{method:'POST',data:{}})).status,200);
    });
    await t.test('密钥轮换立即撤销旧密钥',async()=>{
      const rotated=await call('/api/nodes/'+id+'/token',{method:'POST',data:{}});
      assert.equal(rotated.status,200);assert.equal((await call('/api/agent/config',{admin:false,secret})).status,401);
      assert.equal((await call('/api/agent/config',{admin:false,secret:rotated.data.token})).status,200);
    });
    await t.test('离线告警去重，恢复后发送恢复通知',async()=>{
      const c=await call('/api/nodes',{method:'POST',data:{name:'offline-test'}});
      app.db.prepare('UPDATE nodes SET last_seen=? WHERE id=?').run(Math.floor(Date.now()/1000)-120,c.data.id);
      await app.notifications();await app.notifications();
      assert.equal(app.db.prepare('SELECT COUNT(*) n FROM outbox WHERE event_key LIKE ?').get('offline:'+c.data.id+':%').n,1);
      assert.equal((await call('/api/agent/report',{method:'POST',admin:false,secret:c.data.token,data:report()})).status,200);
      await app.notifications();await app.notifications();
      assert.equal(app.db.prepare('SELECT COUNT(*) n FROM outbox WHERE event_key LIKE ?').get('recovery:'+c.data.id+':%').n,1);
      await call('/api/nodes/'+c.data.id,{method:'DELETE'});
    });
    await t.test('vnStat 数据库重置时保留原日流量并标记异常',async()=>{
      const c=await call('/api/nodes',{method:'POST',data:{name:'counter-regression-test'}});
      const submit=days=>call('/api/agent/report',{method:'POST',admin:false,secret:c.data.token,data:report({days,history_timezone:'Asia/Shanghai'})});
      assert.equal((await submit([{date:today,rx:5000,tx:8000}])).status,200);
      await new Promise(r=>setTimeout(r,2100));
      assert.equal((await submit([{date:today,rx:10,tx:20}])).status,200);
      const n=(await call('/api/nodes')).data.nodes.find(n=>n.id===c.data.id);
      assert.equal(n.traffic.measured,13000);assert.match(n.history_error,/低于/);
      await call('/api/nodes/'+c.data.id,{method:'DELETE'});
    });
    await t.test('50 台机器批量上报与列表查询',async()=>{
      const nodes=[];for(let i=0;i<50;i++){const c=await call('/api/nodes',{method:'POST',data:{name:'load-'+i}});assert.equal(c.status,201);nodes.push(c.data);}
      const start=performance.now();
      const results=await Promise.all(nodes.map(n=>call('/api/agent/report',{method:'POST',admin:false,secret:n.token,data:report()})));
      assert.ok(results.every(r=>r.status===200));const elapsed=performance.now()-start;
      console.log(`50 台首次上报：${elapsed.toFixed(1)} ms（本机功能测试，非 VPS 压测）`);
      const list=await call('/api/nodes');assert.equal(list.data.nodes.length,51);assert.equal(list.data.nodes.filter(n=>n.status==='online').length,51);
    });
    await t.test('停用节点拒绝上报，删除级联清理',async()=>{
      const n=await call('/api/nodes',{method:'POST',data:{name:'disabled',enabled:false}});
      assert.equal((await call('/api/agent/config',{admin:false,secret:n.data.token})).status,401);
      assert.equal((await call('/api/nodes/'+n.data.id,{method:'DELETE'})).status,200);
      assert.equal(app.db.prepare('SELECT 1 FROM nodes WHERE id=?').get(n.data.id),undefined);
    });
    await t.test('重启保存配置、流量和分钟趋势，原登录会话失效',async()=>{
      await app.close();app=await createApp(options);await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;
      assert.equal((await call('/api/nodes')).status,401);
      const login=await call('/api/login',{method:'POST',data:{username:'admin',password:options.password}});cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.data.csrf;
      const nodes=await call('/api/nodes');assert.equal(nodes.data.nodes.length,51);assert.equal(nodes.data.nodes.find(n=>n.id===id).traffic.measured,3000);
      const history=await call('/api/nodes/'+id+'/history');assert.ok(history.data.minutes.length>=1);assert.equal(history.data.minutes[0].rx,1024);
    });
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
