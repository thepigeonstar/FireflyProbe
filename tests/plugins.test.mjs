import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {loadPlugins} from '../server/plugins.mjs';
import {createApp} from '../server/main.mjs';

test('插件注册表限制重复 ID、路径越界、模块大小；默认无插件',()=>{
 const dir=mkdtempSync(join(tmpdir(),'firefly-registry-'));try{
  assert.deepEqual(loadPlugins(dir).list(),[]);writeFileSync(join(dir,'example.js'),'export function mount() {}');const item={id:'test-plugin',name:'Example',description:'Test',version:'1.0.0',entry:'example.js'};
  const save=rows=>writeFileSync(join(dir,'registry.json'),JSON.stringify(rows));save([item]);assert.equal(loadPlugins(dir).list()[0].id,item.id);
  for(const rows of [[item,item],[{...item,entry:'../example.js'}],[{...item,entry:'/example.js'}],[{...item,id:'../bad'}]]){save(rows);assert.throws(()=>loadPlugins(dir));}
  save([item]);writeFileSync(join(dir,'example.js'),'x'.repeat(512*1024+1));assert.throws(()=>loadPlugins(dir));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('插件列表与模块仅管理员可读；手动国旗优先、标题校验与公开不泄露后台配置',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'firefly-plugin-api-')),item={id:'test-plugin',name:'Example',description:'Test',version:'1.0.0',entry:'example.js'};writeFileSync(join(dir,'registry.json'),JSON.stringify([item]));writeFileSync(join(dir,'example.js'),'export function mount() {}');
 const app=await createApp({password:'plugin-admin-test-2026',dbPath:join(dir,'db.sqlite'),pluginDirectory:dir,disableExternal:true,disableTelegram:true});await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
 const call=async(path,method='GET',data)=>fetch(base+path,{method,headers,body:data===undefined?undefined:JSON.stringify(data)});
 try{
  assert.equal((await call('/api/plugins')).status,401);assert.equal((await call('/api/plugins/test-plugin/module')).status,401);assert.equal((await call('/plugins/example.js')).status,404);
  const login=await call('/admin/api/login','POST',{username:'admin',password:'plugin-admin-test-2026'}),session=await login.json();headers={...headers,Cookie:login.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':session.csrf};
  assert.deepEqual(await(await call('/api/plugins')).json(),[{id:item.id,name:item.name,description:item.description,version:item.version}]);const module=await call('/api/plugins/test-plugin/module');assert.equal(module.status,200);assert.ok(module.headers.get('content-type').includes('javascript'));assert.equal(await module.text(),'export function mount() {}');assert.equal((await call('/api/plugins/missing/module')).status,404);
  const node=await(await call('/api/nodes','POST',{name:'country fixture',public_visible:true,country_override:'JP'})).json();app.db.prepare('UPDATE nodes SET country_code=? WHERE id=?').run('US',node.id);const nodes=await(await call('/api/nodes')).json();assert.equal(nodes.nodes[0].country_code,'JP');assert.equal(nodes.nodes[0].country_override,'JP');assert.equal((await call('/api/nodes/'+node.id,'PUT',{country_override:'<script>'})).status,400);
  await call('/api/settings','PUT',{public_enabled:true,public_title:'我的服务器',overview_title:'我的监控中心'});const data=await(await call('/api/public')).json();assert.equal(data.brand.public_title,'我的服务器');assert.equal(data.brand.overview_title,'我的监控中心');assert.equal(data.nodes[0].country_code,'JP');assert.ok(!JSON.stringify(data).includes('country_override'));
  await call('/api/nodes/'+node.id,'PUT',{country_override:''});assert.equal((await(await call('/api/nodes')).json()).nodes[0].country_code,'US');assert.equal((await call('/api/settings','PUT',{public_title:''})).status,400);assert.equal((await call('/api/settings','PUT',{overview_title:'x'.repeat(121)})).status,400);assert.equal((await call('/api/settings','PUT',{overview_title:'bad\nline'})).status,400);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
