import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';
import {validatePaths} from '../server/account.mjs';

test('访问路径校验：拒绝保留路径、冲突、编码与注入，允许公开首页',()=>{
  assert.deepEqual(validatePaths({}),{admin_path:'/admin',public_path:'/'});
  for(const path of ['/','/api','/public','/a/b','//evil.com','/a%2fb','/a"b'])assert.throws(()=>validatePaths({admin_path:path}));
  assert.throws(()=>validatePaths({admin_path:'/same',public_path:'/SAME'}));assert.equal(validatePaths({public_path:'/public'}).public_path,'/public');
});
test('管理员入口、密码修改、会话撤销、重启与备份恢复保留当前账号',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-account-')),dbPath=join(dir,'db.sqlite'),oldPassword='account-original-password-2026',newPassword='account-updated-password-2026';let app,base,headers,loginPath='/admin/api/login';
  async function start(){app=await createApp({password:oldPassword,dbPath,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+app.server.address().port;headers={'Content-Type':'application/json'};}
  const call=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:response.status,body:await response.json(),response};};
  async function login(username='admin',password=oldPassword){const result=await call(loginPath,'POST',{username,password});if(result.status===200)headers={...headers,Cookie:result.response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':result.body.csrf};return result;}
  try{
    await start();const landing=await fetch(base+'/');assert.ok(!(await landing.text()).includes('login-form'));assert.equal((await fetch(base+'/index.html')).status,404);assert.equal((await fetch(base+'/admin')).status,200);assert.equal((await call('/api/login','POST',{username:'admin',password:oldPassword})).status,404);
    await login();const firstSession={...headers};await login();const secondSession={...headers};headers=firstSession;
    assert.equal((await call('/api/account','POST',{current_password:'wrong',new_password:newPassword})).status,403);assert.equal((await call('/api/account','POST',{current_password:oldPassword,new_password:'short'})).status,400);
    const backup=await call('/api/backups','POST',{}),download=await fetch(base+'/api/backups/'+backup.body.name,{headers}),bytes=Buffer.from(await download.arrayBuffer());
    assert.equal((await call('/api/account','POST',{username:'owner',current_password:oldPassword,new_password:newPassword})).status,200);assert.equal((await call('/api/nodes')).status,401);assert.equal((await fetch(base+'/api/nodes',{headers:secondSession})).status,401);assert.equal((await login('admin',oldPassword)).status,401);assert.equal((await login('owner',newPassword)).status,200);
    const stored=app.db.prepare("SELECT value FROM settings WHERE key='admin_auth'").get().value;assert.ok(!stored.includes(oldPassword));assert.ok(!stored.includes(newPassword));assert.equal((await call('/api/settings')).body.admin_user,'owner');assert.equal((await call('/api/settings')).body.admin_auth,undefined);
    const restored=await fetch(base+'/api/backups/restore',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.sqlite3'},body:bytes});assert.equal(restored.status,200);assert.equal((await login('admin',oldPassword)).status,401);assert.equal((await login('owner',newPassword)).status,200);
    const changed=await call('/api/settings','PUT',{admin_path:'/private-console',public_path:'/status',login_subtitle:'自定义登录说明'});assert.equal(changed.status,200);assert.equal(changed.body.redirect_admin,'/private-console');assert.equal((await call('/api/nodes')).status,401);assert.equal((await fetch(base+'/admin')).status,404);assert.equal((await call('/admin/api/login','POST',{username:'owner',password:newPassword})).status,404);
    loginPath='/private-console/api/login';assert.equal((await login('owner',newPassword)).status,200);const home=await fetch(base+'/',{redirect:'manual'});assert.equal(home.headers.get('location'),'/status');const pub=await fetch(base+'/status');assert.match(await pub.text(),/data-public-path="\/status"/);const admin=await fetch(base+'/private-console');assert.match(await admin.text(),/data-admin-path="\/private-console"/);const branding=(await call('/api/brand')).body;assert.equal(branding.login_subtitle,'自定义登录说明');assert.equal(branding.admin_path,undefined);
    await app.close();app=null;await start();assert.equal((await login('owner',newPassword)).status,200);assert.equal((await login('admin',oldPassword)).status,401);assert.equal((await call('/api/settings')).body.admin_path,'/private-console');
    await call('/api/settings','PUT',{public_path:'/public'});const compatible=await fetch(base+'/public',{redirect:'manual'});assert.equal(compatible.status,200);assert.equal((await fetch(base+'/',{redirect:'manual'})).headers.get('location'),'/public');
  }finally{if(app)await app.close();rmSync(dir,{recursive:true,force:true});}
});
