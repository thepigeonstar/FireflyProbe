import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {openStore} from '../server/store.mjs';import {nextExpiry,renewOnlineNodes} from '../server/auto-renew.mjs';
test('按自然月自动续期，同日、季付年付、月底和闰年保持原日期锚点',()=>{
 assert.equal(nextExpiry('2026-10-18',1,'2026-10-18').expires,'2026-11-18');assert.equal(nextExpiry('2026-10-18',3,'2026-10-18').expires,'2027-01-18');assert.equal(nextExpiry('2026-10-18',12,'2026-10-18').expires,'2027-10-18');const feb=nextExpiry('2026-01-31',1,'2026-01-31');assert.equal(feb.expires,'2026-02-28');assert.equal(nextExpiry(feb.expires,1,'2026-02-28',feb.anchor_day).expires,'2026-03-31');assert.equal(nextExpiry('2028-02-29',12,'2028-02-29').expires,'2029-02-28');assert.equal(nextExpiry('2024-10-18',1,'2026-10-18').expires,'2026-11-18');assert.equal(nextExpiry('2026-11-18',1,'2026-10-18'),null);assert.equal(nextExpiry('2026-10-18',0,'2026-10-18'),null);
});
test('自动续期统一使用付款周期，旧独立周期不再生效',()=>{
 const dir=mkdtempSync(join(tmpdir(),'renew-payment-cycle-')),db=openStore(join(dir,'db.sqlite')),stamp=Date.parse('2026-10-18T12:00:00+08:00')/1000;
 try{
  for(const months of [1,3,12,24])db.prepare('INSERT INTO nodes(id,token_hash,name,created,expires,last_seen,cost_months,auto_renew_months) VALUES(?,?,?,1,?,?,?,?)').run('cycle-'+months,'token-'+months,'cycle-'+months,'2026-10-18',stamp,months,6);
  const changes=renewOnlineNodes(db,db.prepare('SELECT * FROM nodes').all().map(n=>({...n,status:'online'})),'Asia/Shanghai',stamp);assert.equal(changes.length,4);
  for(const months of [1,3,12,24])assert.equal(db.prepare('SELECT expires FROM nodes WHERE id=?').get('cycle-'+months).expires,nextExpiry('2026-10-18',months,'2026-10-18').expires);
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
test('到期当天的新在线上报才续期，离线/关闭/停用/无日期跳过，重复执行不再续',()=>{
 const dir=mkdtempSync(join(tmpdir(),'auto-renew-')),db=openStore(join(dir,'db.sqlite')),stamp=Date.parse('2026-10-18T00:00:10+08:00')/1000;
 try{for(const id of ['online','stale','offline','disabled','off','empty'])db.prepare('INSERT INTO nodes(id,token_hash,name,created,expires,last_seen) VALUES(?,?,?,1,?,?)').run(id,id,id,id==='empty'?'':'2026-10-18',id==='stale'?stamp-20:stamp);db.prepare('UPDATE nodes SET auto_renew=0 WHERE id=?').run('off');db.prepare('UPDATE nodes SET enabled=0 WHERE id=?').run('disabled');const nodes=db.prepare('SELECT * FROM nodes').all().map(n=>({...n,status:n.id==='offline'?'offline':'online'}));for(const event of ['expiry:online:2026-10-18:0','expired:online:2026-10-18','expiry:online:2026-11-18:7','other:test'])db.prepare('INSERT INTO outbox(event_key,message,created) VALUES(?,?,?)').run(event,'fixture',stamp);
  const changes=renewOnlineNodes(db,nodes,'Asia/Shanghai',stamp);assert.deepEqual(changes.map(c=>c.id),['online']);const row=db.prepare('SELECT * FROM nodes WHERE id=?').get('online');assert.equal(row.expires,'2026-11-18');assert.equal(row.last_renewed_from,'2026-10-18');assert.equal(row.last_renewed_at,stamp);assert.equal(row.renewal_anchor_day,18);assert.equal(db.prepare("SELECT COUNT(*) n FROM outbox WHERE status='failed'").get().n,2);assert.equal(renewOnlineNodes(db,nodes,'Asia/Shanghai',stamp+1).length,0);assert.equal(db.prepare('SELECT expires FROM nodes WHERE id=?').get('offline').expires,'2026-10-18');
 }finally{db.close();rmSync(dir,{recursive:true,force:true});}
});
