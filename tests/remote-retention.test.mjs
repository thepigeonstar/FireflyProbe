import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneRemoteBackups,remoteFields} from '../server/remote-backup.mjs';
import {createApp} from '../server/main.mjs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const name=t=>'firefly-'+t+'-00000000-0000-4000-8000-000000000000.ffbackup';
test('保留份数兼容旧配置，清理仅限专用目录中的萤火备份，保护最新上传',async()=>{
 assert.equal(remoteFields({},{}).keep_count,0);for(const keep_count of [-1,101,1.5,'7'])assert.throws(()=>remoteFields({keep_count},{}));
 const files=[1700000000,1700000001,1700000002].map(t=>({Name:name(t),Path:name(t),IsDir:false}));files.push({Name:'other.zip',Path:'other.zip',IsDir:false},{Name:name(1600000000),Path:'nested/'+name(1600000000),IsDir:false});const calls=[];
 await pruneRemoteBackups(async(binary,args)=>{calls.push(args);return {stdout:JSON.stringify(files)};},{remote:'gdrive',folder:'FireflyProbe',keep_count:2},'private.conf',name(1700000002));assert.equal(calls.length,2);assert.equal(calls[1][0],'deletefile');assert.equal(calls[1][1],'gdrive:FireflyProbe/'+name(1700000000));
 for(const list of [files.filter(f=>f.Name!==name(1700000002)),[...files,files[0]]]){const deletes=[];await assert.rejects(()=>pruneRemoteBackups(async(binary,args)=>{if(args[0]==='deletefile')deletes.push(args);return {stdout:JSON.stringify(list)};},{remote:'gdrive',folder:'FireflyProbe',keep_count:1},'private.conf',name(1700000002)));assert.equal(deletes.length,0);}
});
test('上传失败不清理旧备份，清理失败保留上传成功状态和独立提示',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'retention-integration-'));let failUpload=false,calls=[];
 const app=await createApp({password:'retention-admin-2026',dbPath:join(dir,'db.sqlite'),disableExternal:true,disableTelegram:true,runRclone:async(binary,args)=>{calls.push(args[0]);if(args[0]==='copyto'){if(failUpload)throw Error('upload error');return {};}if(args[0]==='lsjson')throw Error('list unavailable');throw Error('unexpected delete');}});
 try{app.remoteBackup.importConfig('[gdrive]\ntype = drive\ntoken = '+JSON.stringify({access_token:'fake-access',refresh_token:'fake-refresh'})+'\n');app.remoteBackup.save({remote:'gdrive',keep_count:7,password:'retention-encryption-2026'});app.remoteBackup.start();while(app.remoteBackup.busy)await new Promise(r=>setTimeout(r,10));assert.equal(app.remoteBackup.view().state.status,'success');assert.ok(app.remoteBackup.view().state.cleanup_error);assert.deepEqual(calls,['copyto','lsjson']);
 calls=[];failUpload=true;app.remoteBackup.start();while(app.remoteBackup.busy)await new Promise(r=>setTimeout(r,10));assert.equal(app.remoteBackup.view().state.status,'failed');assert.deepEqual(calls,['copyto']);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
