import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {openStore} from '../server/store.mjs';
import {createAccount} from '../server/account.mjs';
import {createApp} from '../server/main.mjs';
test('本地恢复工具显示入口并恢复环境账号，输出不含密码',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-recover-account-')),file=join(dir,'lightprobe.sqlite'),db=openStore(file),password='recovered-env-password-2026';let app;
  try{await createAccount(db,'old-owner','old-owner-password-2026');db.prepare("INSERT INTO settings VALUES('config',?)").run(JSON.stringify({timezone:'Asia/Shanghai',admin_path:'/secret-entry',public_path:'/status'}));db.close();const tool=fileURLToPath(new URL('../tools/recover-admin.mjs',import.meta.url)),env={...process.env,DATA_DIR:dir,ADMIN_USER:'restored-owner',ADMIN_PASSWORD:password};const shown=execFileSync(process.execPath,[tool,'--show-path'],{env,encoding:'utf8',windowsHide:true});assert.match(shown,/secret-entry/);const result=execFileSync(process.execPath,[tool,'--reset-account'],{env,encoding:'utf8',windowsHide:true});assert.ok(!result.includes(password));app=await createApp({dbPath:file,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const response=await fetch('http://127.0.0.1:'+app.server.address().port+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'restored-owner',password})});assert.equal(response.status,200);assert.equal(JSON.parse(app.db.prepare("SELECT value FROM settings WHERE key='config'").get().value).public_path,'/status');}finally{if(app)await app.close();if(db.isOpen)db.close();rmSync(dir,{recursive:true,force:true});}
});
