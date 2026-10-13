import test from 'node:test';
import assert from 'node:assert/strict';
import {forwardedClientIP,proxyPolicy,createLoginLimiter,createClientIP} from '../server/login-security.mjs';
import {createApp} from '../server/main.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('真实 IP 仅采信可信代理，逆向验证代理链，拒绝伪造和非法地址',async()=>{
 const trusted=proxyPolicy('127.0.0.1/32,::1/128,172.18.0.1/32');assert.equal(forwardedClientIP('127.0.0.1','1.1.1.1, 8.8.8.8',trusted),'8.8.8.8');assert.equal(forwardedClientIP('172.18.0.1','8.8.8.8, 127.0.0.1',trusted),'8.8.8.8');assert.equal(forwardedClientIP('8.8.4.4','1.1.1.1',trusted),'8.8.4.4');assert.equal(forwardedClientIP('127.0.0.1','bad,8.8.8.8',trusted),'127.0.0.1');assert.equal(trusted('172.18.0.2'),false);assert.equal(trusted('::ffff:127.0.0.1'),true);assert.throws(()=>proxyPolicy('invalid/32'));assert.throws(()=>proxyPolicy('1.1.1.1/33'));
 const client=createClientIP('127.0.0.1/32');assert.equal(await client({socket:{remoteAddress:'127.0.0.1'},headers:{'x-forwarded-for':'::ffff:8.8.8.8'}}),'8.8.8.8');
});
test('IP 硬限流独立，账号失败跨 IP 渐进延迟；成功解锁账号延迟',()=>{
 let time=1000;const limits=createLoginLimiter(()=>time);for(let i=0;i<15;i++)assert.equal(limits.attempt('A','admin'),0);assert.throws(()=>limits.attempt('A','admin'),e=>e.status===429);assert.equal(limits.attempt('B','admin'),0);for(let i=0;i<20;i++)limits.result('admin',false);assert.equal(limits.attempt('C','ADMIN'),750);limits.result('admin',true);assert.equal(limits.attempt('D','admin'),0);time+=300001;limits.prune();assert.equal(limits.attempt('A','admin'),0);
});
test('同一 Nginx 后不同访客不共享锁定；更换伪造的链首不能绕过访客限流',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'login-proxy-')),app=await createApp({password:'proxy-admin-test-2026',dbPath:join(dir,'db.sqlite'),trustedProxies:'127.0.0.1/32',disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{const login=(ip,username,password)=>fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-Forwarded-For':ip},body:JSON.stringify({username,password})});for(let i=0;i<15;i++)assert.equal((await login('1.1.1.'+(i+1)+', 8.8.8.8','wrong','wrong')).status,401);assert.equal((await login('9.9.9.9, 8.8.8.8','admin','proxy-admin-test-2026')).status,429);assert.equal((await login('8.8.4.4','admin','proxy-admin-test-2026')).status,200);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
