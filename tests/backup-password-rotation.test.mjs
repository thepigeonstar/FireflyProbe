import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createApp} from '../server/main.mjs';
import {decryptArchive} from '../server/backup-archive.mjs';
test('修改远程备份密码仅影响新文件，旧/新文件分别验证创建时的密码',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'firefly-rotate-')),archives=[];const app=await createApp({password:'rotation-admin-test-2026',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true,runRclone:async(unused,args)=>{archives.push(Buffer.from(readFileSync(args[1])));return {};}});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;
 try{const login=await fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'rotation-admin-test-2026'})}),session=await login.json(),headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};const call=async(path,method,data)=>{const r=await fetch(base+path,{method,headers,body:JSON.stringify(data)});assert.ok(r.ok,await r.clone().text());return r.json();};
  await call('/api/remote-backup/token','POST',{token:JSON.stringify({access_token:'rotation-test-access',refresh_token:'rotation-test-refresh'})});
  for(const password of ['old-backup-password-2026','new-backup-password-2026']){await call('/api/remote-backup','PUT',{remote:'gdrive',password});await call('/api/remote-backup/run','POST',{});for(let i=0;i<100&&app.remoteBackup.busy;i++)await new Promise(r=>setTimeout(r,10));assert.equal(app.remoteBackup.view().state.status,'success');}
  assert.equal(archives.length,2);const oldFile=join(dir,'old.ffbackup'),newFile=join(dir,'new.ffbackup');writeFileSync(oldFile,archives[0]);writeFileSync(newFile,archives[1]);await assert.rejects(()=>decryptArchive(oldFile,'new-backup-password-2026'));await assert.rejects(()=>decryptArchive(newFile,'old-backup-password-2026'));assert.deepEqual(readFileSync(oldFile),archives[0]);assert.deepEqual(readFileSync(newFile),archives[1]);assert.equal((await decryptArchive(oldFile,'old-backup-password-2026')).version,1);assert.equal((await decryptArchive(newFile,'new-backup-password-2026')).version,1);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
