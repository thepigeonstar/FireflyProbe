import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {createAccount,validateUsername,validatePassword} from '../server/account.mjs';
const action=process.argv[2];
if(!['--show-path','--reset-account'].includes(action)){console.error('用法：node tools/recover-admin.mjs --show-path 或 --reset-account');process.exit(2);}
const file=join(process.env.DATA_DIR||'data','lightprobe.sqlite');
const db=new DatabaseSync(file,{readOnly:action==='--show-path'});
try{
  const config=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='config'").get()?.value||'{}');
  if(action==='--show-path'){console.log('管理入口：'+(config.admin_path||'/admin'));console.log('公开入口：'+(config.public_path||'/'));}
  else{
    const username=validateUsername(process.env.ADMIN_USER||'admin'),password=validatePassword(process.env.ADMIN_PASSWORD);
    db.exec('BEGIN IMMEDIATE');
    try{db.prepare("DELETE FROM settings WHERE key='admin_auth'").run();await createAccount(db,username,password);config.admin_path='/admin';db.prepare("INSERT INTO settings VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(config));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}
    console.log('已恢复 .env 中的管理员账号密码，管理入口为 /admin。请重启主控使当前会话失效。');
  }
}finally{db.close();}
