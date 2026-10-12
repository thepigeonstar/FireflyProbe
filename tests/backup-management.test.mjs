import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';

test('备份删除需登录与 CSRF，仅删除已完成快照；保留份数和最近通知限制生效',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-backup-management-')),app=await createApp({password:'backup-management-test-2026',dbPath:join(dir,'db.sqlite'),disableTelegram:true});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
  const call=async(path,method='GET',body,override)=>{const response=await fetch(base+path,{method,headers:override||headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),response};};
  try{
    assert.equal((await call('/api/backups/backup-unknown.sqlite','DELETE')).status,401);const login=await call('/admin/api/login','POST',{username:'admin',password:'backup-management-test-2026'});headers={...headers,Cookie:login.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':login.body.csrf};
    await call('/api/settings','PUT',{backup_keep:3});await call('/api/nodes','POST',{name:'current-data'});const names=[];for(let i=0;i<4;i++){const snapshot=await call('/api/backups','POST',{});assert.equal(snapshot.status,201);names.push(snapshot.body.name);}
    const list=(await call('/api/backups')).body;assert.equal(list.length,3);assert.ok(!list.some(row=>row.name===names[0]));const name=list[0].name,file=join(dir,'backups',name);
    assert.equal((await call('/api/backups/'+name,'DELETE',undefined,{Cookie:headers.Cookie})).status,403);assert.ok(existsSync(file));assert.equal((await call('/api/backups/'+name,'DELETE')).status,200);assert.equal(existsSync(file),false);assert.equal(existsSync(file+'.ready'),false);assert.equal((await call('/api/backups/'+name,'GET')).status,404);assert.equal((await call('/api/backups/'+name,'DELETE')).status,404);assert.equal((await call('/api/nodes')).body.nodes[0].name,'current-data');
    const incomplete='backup-123-incomplete.sqlite';writeFileSync(join(dir,'backups',incomplete),'incomplete');assert.equal((await call('/api/backups/'+incomplete,'DELETE')).status,404);assert.equal((await call('/api/backups/..%2Fdb.sqlite','DELETE')).status,404);assert.ok(existsSync(join(dir,'db.sqlite')));
    const insert=app.db.prepare("INSERT INTO outbox(event_key,message,status,created) VALUES(?,?,'sent',1)");for(let i=0;i<12;i++)insert.run('fixture:'+i,'fixture '+i);const notices=(await call('/api/notifications')).body;assert.equal(notices.length,5);assert.ok(notices.every((row,i)=>i===0||row.id<notices[i-1].id));assert.equal(app.db.prepare('SELECT COUNT(*) n FROM outbox').get().n,12);assert.equal((await call('/api/notifications','DELETE')).status,404);
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
