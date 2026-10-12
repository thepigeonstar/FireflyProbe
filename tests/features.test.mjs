import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {createApp} from '../server/main.mjs';
import {openStore,dayKey,dailyTotals} from '../server/store.mjs';
import {costSummary,createRates} from '../server/costs.mjs';
import {inQuiet} from '../server/alarms.mjs';

test('旧版数据库迁移保留数据并生成迁移前备份',()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-migration-')),file=join(dir,'db.sqlite');
  const old=new DatabaseSync(file);old.exec("CREATE TABLE nodes(id TEXT PRIMARY KEY,token_hash TEXT UNIQUE NOT NULL,name TEXT NOT NULL,group_name TEXT DEFAULT '',sort INTEGER DEFAULT 0,interface TEXT DEFAULT '',quota REAL DEFAULT 0,billing_day INTEGER DEFAULT 1,billing_mode TEXT DEFAULT 'sum',expires TEXT DEFAULT '',enabled INTEGER DEFAULT 1,created INTEGER,last_seen INTEGER DEFAULT 0,history_seen INTEGER DEFAULT 0,history_error TEXT DEFAULT '',history_timezone TEXT DEFAULT ''); PRAGMA user_version=1;");old.prepare('INSERT INTO nodes(id,token_hash,name,created) VALUES(?,?,?,?)').run('old','a'.repeat(64),'old-node',1);old.close();
  const db=openStore(file);try{const row=db.prepare('SELECT * FROM nodes').get();assert.equal(row.name,'old-node');assert.equal(row.cost_currency,'CNY');assert.equal(row.public_visible,0);assert.equal(db.prepare('PRAGMA user_version').get().user_version,3);assert.ok(readdirSync(join(dir,'backups')).some(x=>x.startsWith('migration-v1-')));}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('费用换算先摊分再汇总，缺少汇率时不伪造零元',()=>{
  const rates={rates:{USD:{rate:8,date:'2020-01-01'},EUR:{rate:10,date:'2020-01-01'}}};
  const a={id:'a',name:'A',group_name:'亚洲',cost_amount:45,cost_months:12,cost_currency:'USD',cost_active:1,enabled:1};
  const b={...a,id:'b',cost_amount:30,cost_months:3,cost_currency:'EUR',enabled:0};
  const c={...a,id:'c',cost_currency:'GBP'};
  assert.equal(costSummary([a,b],rates).monthly_rmb,130);assert.equal(costSummary([a,b],rates).annual_rmb,1560);assert.equal(costSummary([a,c],rates).monthly_rmb,null);assert.equal(costSummary([a,c],rates).known_monthly_rmb,30);assert.equal(costSummary([{...a,cost_active:0}],rates).monthly_rmb,0);
  assert.equal(costSummary([{...a,group_name:'__proto__'}],rates).groups[0].monthly_rmb,30);
});
test('更新前备份工具读取运行中 WAL 数据，并保留指定份数',()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-cli-backup-')),db=openStore(join(dir,'lightprobe.sqlite'));
  try{db.prepare("INSERT INTO settings VALUES('config',?)").run(JSON.stringify({timezone:'Asia/Shanghai',backup_keep:2}));db.prepare('INSERT INTO nodes(id,token_hash,name,created) VALUES(?,?,?,?)').run('n','a'.repeat(64),'running-node',1);for(let i=0;i<3;i++)execFileSync(process.execPath,[fileURLToPath(new URL('../tools/backup.mjs',import.meta.url))],{env:{...process.env,DATA_DIR:dir},windowsHide:true});const files=readdirSync(join(dir,'backups')).filter(x=>x.endsWith('.sqlite'));assert.equal(files.length,2);assert.equal(readdirSync(join(dir,'backups')).filter(x=>x.endsWith('.ready')).length,2);const copy=new DatabaseSync(join(dir,'backups',files[0]),{readOnly:true});try{assert.equal(copy.prepare('SELECT name FROM nodes').get().name,'running-node');}finally{copy.close();}}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('跨午夜静默时段与流量预测按完整日计算',()=>{
  const s={timezone:'UTC',quiet_enabled:true,quiet_start:'23:00',quiet_end:'08:00'};assert.equal(inQuiet(s,new Date('2026-10-12T23:30:00Z')),true);assert.equal(inQuiet(s,new Date('2026-10-12T07:00:00Z')),true);assert.equal(inQuiet(s,new Date('2026-10-12T09:00:00Z')),false);
  const dir=mkdtempSync(join(tmpdir(),'firefly-forecast-')),db=openStore(join(dir,'db.sqlite'));
  try{db.prepare('INSERT INTO nodes(id,token_hash,name,created,quota) VALUES(?,?,?,?,?)').run('n','a'.repeat(64),'n',0,1000);for(const day of ['2026-10-09','2026-10-10','2026-10-11'])db.prepare('INSERT INTO daily VALUES(?,?,?,?,?)').run('n','eth0',day,100,100);const totals=dailyTotals(db,db.prepare('SELECT * FROM nodes').get(),'2026-10-12');assert.equal(totals.remaining,400);assert.equal(totals.daily_average,200);assert.equal(totals.forecast,'2026-10-14');assert.equal(totals.days_remaining,20);}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('汇率刷新失败保留上一次有效缓存',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-fx-')),db=openStore(join(dir,'db.sqlite'));let fail=false;
  const fx=createRates(()=>db,{fetchRates:async()=>{if(fail)throw new Error('offline');return [{base:'CNY',quote:'USD',date:'2020-01-01',rate:0.125}];}});
  try{await fx.refresh(true);assert.equal(fx.read().rates.USD.rate,8);fail=true;await fx.refresh(true);assert.equal(fx.read().rates.USD.rate,8);assert.equal(fx.read().error,'offline');}finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('新增接口：费用、公开白名单、备份恢复、持续资源告警',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'firefly-features-'));
  const app=await createApp({password:'feature-test-password-2026',dbPath:join(dir,'db.sqlite'),disableTelegram:true,debugErrors:true,fetchRates:async()=>[{base:'CNY',quote:'USD',date:'2020-01-01',rate:0.125},{base:'CNY',quote:'EUR',date:'2020-01-01',rate:0.1}]});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+app.server.address().port;let headers={'Content-Type':'application/json'};
  const call=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
  const login=async()=>{const r=await call('/api/login','POST',{username:'admin',password:'feature-test-password-2026'});assert.equal(r.status,200);const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'feature-test-password-2026'})});const s=await response.json();headers={'Content-Type':'application/json',Cookie:response.headers.get('set-cookie').split(';')[0],'X-CSRF-Token':s.csrf};};
  try{
    assert.equal((await call('/api/costs')).status,401);assert.equal((await call('/api/public')).status,404);await login();
    await call('/api/fx/refresh','POST',{});
    const a=(await call('/api/nodes','POST',{name:'年付 USD',cost_amount:45,cost_currency:'USD',cost_months:12})).body;
    const b=(await call('/api/nodes','POST',{name:'季付 EUR',cost_amount:30,cost_currency:'EUR',cost_months:3,enabled:false})).body;
    await t.test('月均费用独立于监控启用状态，旧客户端修改保留费用',async()=>{assert.equal((await call('/api/costs')).body.monthly_rmb,130);assert.equal((await call('/api/nodes/'+a.id,'PUT',{name:'改名'})).status,200);assert.equal((await call('/api/costs')).body.monthly_rmb,130);assert.equal((await call('/api/nodes','POST',{name:'bad',cost_amount:0.001})).status,400);});
    await t.test('公开接口不泄露费用或凭据',async()=>{for(const id of [a.id,b.id])assert.equal((await call('/api/nodes/'+id,'PUT',{group_name:'统一组',public_visible:true})).status,200);assert.equal((await call('/api/nodes/batch','POST',{})).status,404);await call('/api/settings','PUT',{public_enabled:true,public_show_metrics:true,public_show_traffic:true});const data=(await call('/api/public')).body;assert.equal((await fetch(base+'/api/public')).status,200);assert.equal(data.nodes.length,2);for(const key of ['cost_amount','token_hash','interface','ssh_host','ssh_password','agent_secret'])assert.equal(data.nodes[0][key],undefined);await call('/api/nodes/'+b.id,'PUT',{public_visible:false});assert.equal((await call('/api/public')).body.nodes.length,1);});
    await t.test('高资源持续告警去重，维护和独立告警开关生效',async()=>{await call('/api/settings','PUT',{telegram_token:'123456789:TEST_TOKEN_NOT_REAL',telegram_chat:'123',alert_duration:15});const report={hostname:'private-host',version:'0.1.0',interface:'eth0',rx_speed:1,tx_speed:2,cpu:99,mem_total:100,mem_used:99,disk_total:100,disk_used:99,uptime:1};const r=await fetch(base+'/api/agent/report',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+a.token},body:JSON.stringify(report)});assert.equal(r.status,200);await app.notifications();app.db.prepare('UPDATE alerts SET since=since-30').run();await app.notifications();await app.notifications();assert.equal(app.db.prepare("SELECT COUNT(*) n FROM outbox WHERE event_key LIKE 'resource:%'").get().n,3);await call('/api/nodes/'+a.id,'PUT',{maintenance_until:Math.floor(Date.now()/1000)+3600});await app.notifications();assert.equal(app.db.prepare('SELECT COUNT(*) n FROM alerts').get().n,0);const due=dayKey(new Date(),'Asia/Shanghai');await call('/api/nodes/'+b.id,'PUT',{enabled:true,expires:due});await app.notifications();assert.equal(app.db.prepare("SELECT COUNT(*) n FROM outbox WHERE event_key LIKE 'expiry:%'").get().n,1);const pub=(await call('/api/public')).body;assert.equal(pub.nodes[0].metrics.hostname,undefined);});
    await t.test('趋势范围和降采样参数受限',async()=>{assert.equal((await call('/api/nodes/'+a.id+'/history?hours=168')).status,200);assert.equal((await call('/api/nodes/'+a.id+'/history?hours=100000')).status,400);});
    await t.test('一致备份、恢复前备份、恢复数据并撤销旧会话',async()=>{const created=await call('/api/backups','POST',{});assert.equal(created.status,201);const response=await fetch(base+'/api/backups/'+created.body.name,{headers});const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,16).toString(),'SQLite format 3\0');await call('/api/nodes/'+a.id,'PUT',{name:'恢复前临时名字'});const bad=await fetch(base+'/api/backups/restore',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.sqlite3'},body:Buffer.from('not a database')});assert.equal(bad.status,400);const restored=await fetch(base+'/api/backups/restore',{method:'POST',headers:{...headers,'Content-Type':'application/vnd.sqlite3'},body:bytes});assert.equal(restored.status,200,await restored.text());assert.equal((await call('/api/nodes')).status,401);await login();assert.equal(app.db.prepare('SELECT name FROM nodes WHERE id=?').get(a.id).name,'改名');assert.ok((await call('/api/backups')).body.some(x=>x.name.endsWith('before-restore.sqlite')));});
  }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
