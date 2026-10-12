import {DatabaseSync,backup} from 'node:sqlite';
import {mkdirSync,readdirSync,statSync,rmSync,chmodSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const directory=process.env.DATA_DIR||'/app/data',file=join(directory,'lightprobe.sqlite');
const db=new DatabaseSync(file,{readOnly:true});
const backupDir=join(directory,'backups');mkdirSync(backupDir,{recursive:true});
try{const name='backup-'+Date.now()+'-before-update.sqlite';await backup(db,join(backupDir,name));chmodSync(join(backupDir,name),0o600);writeFileSync(join(backupDir,name)+".ready","ok\n",{mode:0o600});const settings=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='config'").get()?.value??'{}');const keep=Math.max(1,Math.min(30,settings.backup_keep??7));const files=readdirSync(backupDir).filter(x=>/^backup-[a-zA-Z0-9-]+\.sqlite$/.test(x)).sort((a,b)=>statSync(join(backupDir,b)).mtimeMs-statSync(join(backupDir,a)).mtimeMs);for(const old of files.slice(keep)){rmSync(join(backupDir,old));rmSync(join(backupDir,old)+".ready",{force:true});}console.log('更新前备份已保存：'+name);}finally{db.close();}
