import test from 'node:test';
import assert from 'node:assert/strict';
import {sshFields} from '../server/ssh.mjs';
import {createApp} from '../server/main.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('SSH 接受 IP、域名和国际域名，拒绝 URL、端口、命令注入及无效标签',()=>{
 assert.equal(sshFields({ssh_host:'nathkt1.bytevirt.net',ssh_port:2222}).ssh_host,'nathkt1.bytevirt.net');assert.equal(sshFields({ssh_host:' NATHKT1.BYTEVIRT.NET. '}).ssh_host,'nathkt1.bytevirt.net');assert.equal(sshFields({ssh_host:'例子.测试'}).ssh_host,'xn--fsqu00a.xn--0zwm56d');for(const host of ['127.0.0.1','2001:db8::1'])assert.equal(sshFields({ssh_host:host}).ssh_host,host);
 for(const ssh_host of ['https://example.com','example.com:22','example.com/path','root@example.com','example.com;id','-bad.example.com','bad..example.com','bad_.example.com','999.999.999.999','[2001:db8::1]:22','a'.repeat(64)+'.example.com'])assert.throws(()=>sshFields({ssh_host}));
});
test('域名配置通过 API 保存，改变地址或端口撤销原指纹',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'ssh-domain-')),app=await createApp({password:'hostname-admin-2026',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{const login=await fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'hostname-admin-2026'})}),session=await login.json(),headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};const call=async(path,method,data)=>fetch(base+path,{method,headers,body:JSON.stringify(data)});
 const response=await call('/api/nodes','POST',{name:'NAT node',ssh_host:'NATHKT1.BYTEVIRT.NET',ssh_port:2222});assert.equal(response.status,201);const node=await response.json();assert.equal(app.snapshot()[0].ssh_host,'nathkt1.bytevirt.net');app.db.prepare('UPDATE nodes SET ssh_fingerprint=? WHERE id=?').run('SHA256:'+'a'.repeat(43),node.id);await call('/api/nodes/'+node.id,'PUT',{ssh_host:'other.bytevirt.net'});assert.equal(app.snapshot()[0].ssh_fingerprint,'');assert.equal((await call('/api/nodes/'+node.id,'PUT',{ssh_host:'https://bad.example'})).status,400);assert.equal(app.snapshot()[0].ssh_host,'other.bytevirt.net');
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
