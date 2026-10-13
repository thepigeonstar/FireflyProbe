import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server/main.mjs';
import {validateBrand,brandDefaults} from '../server/brand.mjs';
const pixel='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1sAAAAASUVORK5CYII=';

test('品牌输入限制与图片格式校验',()=>{
  assert.equal(validateBrand({brand_name:'萝卜',brand_logo:pixel},brandDefaults).brand_logo,pixel);
  assert.throws(()=>validateBrand({brand_name:''},brandDefaults));
  assert.throws(()=>validateBrand({brand_name:'a'.repeat(61)},brandDefaults));
  assert.throws(()=>validateBrand({brand_logo:'https://example.com/logo.png'},brandDefaults));
  assert.throws(()=>validateBrand({brand_logo:'data:image/svg+xml;base64,PHN2Zz4='},brandDefaults));
  assert.throws(()=>validateBrand({brand_logo:'data:image/png;base64,YWJj'},brandDefaults));
  assert.throws(()=>validateBrand({brand_logo:'data:image/png;base64,'+'A'.repeat(90000)},brandDefaults));
});

test('品牌设置权限、公开登录品牌、通知名称和重启持久化',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-brand-'));
  const opts={password:'brand-test-password-2026',dbPath:join(dir,'test.sqlite'),disableTelegram:true};
  let app=await createApp(opts);
  const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port;};
  let base=await listen();
  try {
    let r=await fetch(base+'/api/brand');assert.equal(r.status,200);assert.equal((await r.json()).brand_name,'萤火');
    r=await fetch(base+'/api/settings',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({brand_name:'bad'})});assert.equal(r.status,401);
    const login=await fetch(base+'/admin/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:opts.password})});
    const session=await login.json(),cookie=login.headers.get('set-cookie').split(';')[0];
    const headers={'Content-Type':'application/json',Cookie:cookie,'X-CSRF-Token':session.csrf};
    r=await fetch(base+'/api/settings',{method:'PUT',headers,body:JSON.stringify({brand_name:'萝卜',brand_english:'Radish Probe',brand_logo:pixel,telegram_token:'123456789:TEST_TOKEN_NOT_REAL',telegram_chat:'12345'})});assert.equal(r.status,200);
    const brand=await(await fetch(base+'/api/brand')).json();assert.deepEqual(Object.keys(brand).sort(),['brand_english','brand_favicon','brand_logo','brand_name','login_subtitle','overview_title','public_title']);assert.equal(brand.brand_logo,pixel);
    const snapshot=await(await fetch(base+'/api/nodes',{headers})).json();assert.equal(snapshot.settings.brand_logo,undefined);
    r=await fetch(base+'/api/notifications/test',{method:'POST',headers,body:'{}'});assert.equal(r.status,200);assert.match(app.db.prepare('SELECT message FROM outbox').get().message,/萝卜 通知测试成功/);
    await app.close();app=await createApp(opts);base=await listen();
    assert.equal((await(await fetch(base+'/api/brand')).json()).brand_logo,pixel);
    assert.equal((await(await fetch(base+'/api/settings')).json()).error,'请登录');
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
