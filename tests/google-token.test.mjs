import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';
import {createVault} from '../server/ssh.mjs';

test('Google 授权结果导入：认证/CSRF、格式校验、加密存储、不回显及助手下载',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'firefly-token-')),app=await createApp({password:'google-token-admin-2026',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
 const call=async(path,method='GET',data)=>{const r=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json(),r};};
 try{assert.equal((await call('/api/remote-backup/token','POST',{token:'{}'})).status,401);const login=await call('/admin/api/login','POST',{username:'admin',password:'google-token-admin-2026'});headers={...headers,Cookie:login.r.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.data.csrf};const csrf=headers['X-CSRF-Token'];delete headers['X-CSRF-Token'];assert.equal((await call('/api/remote-backup/token','POST',{token:'{}'})).status,403);headers['X-CSRF-Token']=csrf;
  for(const token of ['broken','[]','null','{}',JSON.stringify({access_token:'access-only'}),'x'.repeat(16001)])assert.equal((await call('/api/remote-backup/token','POST',{token})).status,400);
  const token=JSON.stringify({access_token:'private-access-token',refresh_token:'private-refresh-token',token_type:'Bearer',expiry:'2030-01-01T00:00:00Z'}),result=await call('/api/remote-backup/token','POST',{token});assert.equal(result.status,200);assert.equal(result.data.configured,true);assert.equal(result.data.remotes[0].name,'gdrive');assert.ok(!JSON.stringify(result.data).includes('private-'));const saved=app.db.prepare("SELECT value FROM settings WHERE key='rclone_config'").get().value;assert.ok(!saved.includes('private-'));const config=createVault(dir).open(saved,'rclone-config');assert.ok(config.includes('scope = drive.file'));assert.ok(config.includes('private-refresh-token'));
  assert.equal((await call('/api/remote-backup/token','POST',{token:'{}'})).status,400);assert.equal(app.db.prepare("SELECT value FROM settings WHERE key='rclone_config'").get().value,saved);const helper=await fetch(base+'/downloads/google-auth.ps1');assert.equal(helper.status,200);assert.ok((await helper.text()).includes('authorize drive --drive-scope drive.file'));assert.equal((await fetch(base+'/tools/google-auth.ps1')).status,404);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
