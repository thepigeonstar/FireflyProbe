import test from 'node:test';
import assert from 'node:assert/strict';
import {createApp} from '../server/main.mjs';
import {openStore} from '../server/store.mjs';
import {createVault} from '../server/ssh.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('旧 Telegram Token 自动加密迁移，接口不回显，留空保留、替换、重启和明确清除',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'telegram-secret-')),file=join(dir,'db.sqlite'),old='123456789:FAKE_LEGACY_TOKEN',fresh='987654321:FAKE_NEW_TOKEN';let db=openStore(file);db.prepare("INSERT INTO settings VALUES('config',?)").run(JSON.stringify({telegram_token:old,telegram_chat:'-123456789'}));db.close();let app=await createApp({password:'telegram-admin-2026',dbPath:file,disableExternal:true,disableTelegram:true});let base,headers;
 const start=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;const login=await fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'telegram-admin-2026'})}),session=await login.json();headers={'Content-Type':'application/json',Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};};
 const call=async(path,method='GET',data)=>{const r=await fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,data:await r.json()};};
 try{await start();const cfg=app.db.prepare("SELECT value FROM settings WHERE key='config'").get().value;assert.ok(!cfg.includes(old));assert.equal(JSON.parse(cfg).telegram_token,undefined);const cipher=app.db.prepare("SELECT value FROM settings WHERE key='telegram_secret'").get().value;assert.ok(!cipher.includes(old));assert.equal(createVault(dir).open(cipher,'telegram-token'),old);assert.equal((await call('/api/settings')).data.telegram_token,undefined);assert.equal((await call('/api/notifications/test','POST',{})).status,200);
 assert.equal((await call('/api/settings','PUT',{telegram_token:''})).data.telegram_configured,true);await call('/api/settings','PUT',{telegram_token:fresh});await app.close();app=await createApp({password:'telegram-admin-2026',dbPath:file,disableExternal:true,disableTelegram:true});await start();assert.equal((await call('/api/notifications/test','POST',{})).status,200);assert.equal(createVault(dir).open(app.db.prepare("SELECT value FROM settings WHERE key='telegram_secret'").get().value,'telegram-token'),fresh);assert.equal((await call('/api/settings','PUT',{telegram_clear:true})).data.telegram_configured,false);assert.equal((await call('/api/notifications/test','POST',{})).status,400);assert.equal(app.db.prepare("SELECT value FROM settings WHERE key='telegram_secret'").get(),undefined);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
