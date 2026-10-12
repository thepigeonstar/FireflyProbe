import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,rmSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import ssh2 from 'ssh2';
const { Server,utils }=ssh2;
import { createVault,sshFields } from '../server/ssh.mjs';
import { createApp } from '../server/main.mjs';

test('SSH 凭据加密绑定节点，密钥可跨重启使用，IP 和端口校验',()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-vault-'));
  try{const vault=createVault(dir),cipher=vault.seal('secret-123','node-a');assert.ok(!cipher.includes('secret'));assert.equal(createVault(dir).open(cipher,'node-a'),'secret-123');assert.throws(()=>vault.open(cipher,'node-b'));assert.throws(()=>vault.open(cipher.slice(0,-6)+'broken','node-a'));assert.equal(sshFields({ssh_host:'2001:db8::1',ssh_port:2222}).ssh_port,2222);assert.throws(()=>sshFields({ssh_host:'127.0.0.1;uname'}));assert.throws(()=>sshFields({ssh_port:0}));assert.throws(()=>sshFields({ssh_user:'root;id'}));}finally{rmSync(dir,{recursive:true,force:true});}
});

test('真实 SSH 协议：指纹确认、密码验证、部署日志脱敏、权限与失败状态',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-ssh-')),password='ssh-private-password-2026';let commandInput='',failInstall=false;
  const sshServer=new Server({hostKeys:[utils.generateKeyPairSync('ed25519').private]},client=>{
    client.on('error',()=>{});
    client.on('authentication',ctx=>{if(ctx.method==='password'&&ctx.username==='root'&&ctx.password===password)ctx.accept();else ctx.reject();});
    client.on('ready',()=>client.on('session',accept=>{const session=accept();session.on('exec',(accept,unused,info)=>{const stream=accept();if(info.command==='id -u'){stream.write('0\n');stream.exit(0);stream.end();return;}assert.equal(info.command,'bash -s');let input='';stream.on('data',chunk=>input+=chunk.toString());stream.on('end',()=>{commandInput=input;const token=/--token '([a-f0-9]{64})'/.exec(input)?.[1];stream.write('installer output\n'+password+'\n'+(token||'')+'\n');stream.exit(failInstall?11:0);stream.end();});});}));
  });
  await new Promise(r=>sshServer.listen(0,'127.0.0.1',r));
  const app=await createApp({password:'ssh-admin-password-2026',dbPath:join(dir,'db.sqlite'),publicURL:'https://probe.example.test',disableTelegram:true});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
  const call=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),response};};
  let a;
  try{
    assert.equal((await call('/api/nodes/00000000-0000-0000-0000-000000000000/ssh/probe','POST',{})).status,401);
    const login=await call('/api/login','POST',{username:'admin',password:'ssh-admin-password-2026'});headers={...headers,Cookie:login.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.body.csrf};
    a=(await call('/api/nodes','POST',{name:'SSH test',ssh_host:'127.0.0.1',ssh_port:sshServer.address().port,ssh_user:'root',ssh_password:password})).body;
    await t.test('配置与公开接口不回显密码或采集密钥，加密数据不会包含明文',async()=>{
      const saved=app.db.prepare('SELECT * FROM nodes WHERE id=?').get(a.id);assert.notEqual(saved.ssh_password,password);assert.notEqual(saved.agent_secret,a.token);assert.equal(createVault(dir).open(saved.ssh_password,a.id),password);
      const result=(await call('/api/nodes')).body.nodes[0];assert.equal(result.ssh_configured,true);assert.equal(result.ssh_password,undefined);assert.equal(result.agent_secret,undefined);assert.equal((await call('/api/nodes/'+a.id,'PUT',{name:'renamed',ssh_password:''})).status,200);assert.equal(app.db.prepare('SELECT ssh_password FROM nodes WHERE id=?').get(a.id).ssh_password,saved.ssh_password);
    });
    await t.test('未确认指纹禁止部署，过期或伪造确认被拒绝',async()=>{
      assert.equal((await call(`/api/nodes/${a.id}/ssh/deploy`,'POST',{})).status,400);assert.equal((await call(`/api/nodes/${a.id}/ssh/trust`,'POST',{fingerprint:'fake'})).status,409);
      const probe=await call(`/api/nodes/${a.id}/ssh/probe`,'POST',{});assert.equal(probe.status,200);assert.match(probe.body.fingerprint,/^SHA256:/);assert.equal(probe.body.trusted,false);assert.equal((await call(`/api/nodes/${a.id}/ssh/trust`,'POST',{fingerprint:probe.body.fingerprint})).status,200);
      const test=await call(`/api/nodes/${a.id}/ssh/test`,'POST',{});assert.equal(test.status,200);assert.equal(test.body.root,true);
    });
    await t.test('已保存指纹必须一致，错误密码无法登录',async()=>{
      const old=app.db.prepare('SELECT ssh_fingerprint FROM nodes WHERE id=?').get(a.id).ssh_fingerprint;app.db.prepare('UPDATE nodes SET ssh_fingerprint=? WHERE id=?').run('SHA256:wrong',a.id);assert.equal((await call(`/api/nodes/${a.id}/ssh/test`,'POST',{})).status,502);app.db.prepare('UPDATE nodes SET ssh_fingerprint=? WHERE id=?').run(old,a.id);
      await call('/api/nodes/'+a.id,'PUT',{ssh_password:'incorrect'});assert.equal((await call(`/api/nodes/${a.id}/ssh/test`,'POST',{})).status,502);await call('/api/nodes/'+a.id,'PUT',{ssh_password:password});
    });
    async function deploy(){const result=await call(`/api/nodes/${a.id}/ssh/deploy`,'POST',{});assert.equal(result.status,202);for(let i=0;i<100;i++){const job=await call('/api/ssh/jobs/'+result.body.id);if(job.body.status!=='running')return job.body;await new Promise(r=>setTimeout(r,30));}throw new Error('SSH task did not finish');}
    await t.test('安装输入经 SSH stdin 传送，成功与失败独立于在线状态，日志隐藏秘密',async()=>{
      const job=await deploy();assert.equal(job.status,'success');assert.ok(commandInput.includes('--server'));assert.ok(commandInput.includes('--upgrade'));assert.ok(commandInput.includes(a.token));assert.ok(!job.log.includes(a.token));assert.ok(!job.log.includes(password));assert.match(job.log,/已隐藏/);assert.equal((await call('/api/nodes')).body.nodes[0].status,'pending');failInstall=true;const failed=await deploy();assert.equal(failed.status,'failed');assert.match(failed.log,/11/);
    });
    await t.test('编辑 SSH 地址会撤销指纹，清除密码禁止继续部署',async()=>{
      assert.equal((await call('/api/nodes/'+a.id,'PUT',{ssh_port:22222})).status,200);assert.equal(app.db.prepare('SELECT ssh_fingerprint FROM nodes WHERE id=?').get(a.id).ssh_fingerprint,'');await call('/api/nodes/'+a.id,'PUT',{ssh_clear:true});assert.equal((await call('/api/nodes')).body.nodes[0].ssh_configured,false);
      assert.equal(readFileSync(join(dir,'ssh-secret.key')).length,32);
    });
  }finally{await app.close();await new Promise(r=>sshServer.close(r));rmSync(dir,{recursive:true,force:true});}
});
