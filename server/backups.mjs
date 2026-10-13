import {decryptArchive} from './backup-archive.mjs';
import {backup,DatabaseSync} from 'node:sqlite';
import {mkdirSync,readdirSync,statSync,rmSync,createWriteStream,openSync,readSync,closeSync,chmodSync,existsSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Transform} from 'node:stream';
export const backupName=/^(backup|migration-v[12])-[a-zA-Z0-9-]+\.sqlite$/;
export function createBackups(getDB,dataDir,getSettings) {
  const directory=join(dataDir,'backups');mkdirSync(directory,{recursive:true,mode:0o700});const pinned=new Set();let busy=false,pending='';
  const list=()=>readdirSync(directory).filter(x=>backupName.test(x)&&x!==pending&&(/^migration-v[12]-/.test(x)||existsSync(join(directory,x+'.ready')))).map(name=>{const s=statSync(join(directory,name));return {name,size:s.size,created:Math.floor(s.mtimeMs/1000),modified:s.mtimeMs};}).sort((a,b)=>b.modified-a.modified);
  async function create(reason='manual') {
    if(busy){const e=new Error('已有备份操作正在进行');e.status=409;throw e;}busy=true;
    const name='backup-'+Date.now()+'-'+reason+'.sqlite',file=join(directory,name);pending=name;
    try {
      await backup(getDB(),file);
      chmodSync(file,0o600);writeFileSync(file+'.ready','ok\n',{mode:0o600});pending='';
      for(const old of list().slice(getSettings().backup_keep??7).filter(row=>!pinned.has(row.name))){rmSync(join(directory,old.name));rmSync(join(directory,old.name+'.ready'),{force:true});}
      return list().find(x=>x.name===name);
    }catch(e){rmSync(file,{force:true});throw e;}finally{busy=false;pending='';}
  }
  function remove(name){
    if(busy||pinned.has(name)){const e=new Error('备份正在创建，请稍后删除');e.status=409;throw e;}
    if(!backupName.test(name)||!list().some(row=>row.name===name)){const e=new Error('备份不存在');e.status=404;throw e;}
    rmSync(join(directory,name));rmSync(join(directory,name+'.ready'),{force:true});
  }
  return {directory,list,create,remove,pin:name=>pinned.add(name),unpin:name=>pinned.delete(name),get busy(){return busy;}};
}
export async function receiveRestore(req,file,password='') {
  let bytes=0;
  const limit=new Transform({transform(chunk,encoding,callback){bytes+=chunk.length;if(bytes>512*1024*1024){const e=new Error('备份超过 512 MiB');e.status=413;callback(e);}else callback(null,chunk);}});
  await pipeline(req,limit,createWriteStream(file,{flags:'wx',mode:0o600}));
  const archive=await decryptArchive(file,password);
  const descriptor=openSync(file,'r'),header=Buffer.alloc(16);try{readSync(descriptor,header,0,16,0);}finally{closeSync(descriptor);}
  if(header.toString()!=='SQLite format 3\0'){const e=new Error('请选择有效的 SQLite 备份文件');e.status=400;throw e;}
  const db=new DatabaseSync(file,{readOnly:true});
  try {
    if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok')throw new Error('备份数据库检查失败');
    const version=db.prepare('PRAGMA user_version').get().user_version;
    if(version<1||version>3)throw new Error('不支持的备份版本');
    const schema=db.prepare("SELECT name,type FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'").all();
    const allowed=new Set(['nodes','daily','minutes','settings','outbox','alerts']);
    if(schema.some(x=>x.type!=='table'||!allowed.has(x.name)))throw new Error('备份包含不支持的数据库对象');
    for(const table of ['nodes','daily','minutes','settings','outbox'])if(!schema.some(x=>x.name===table))throw new Error('备份缺少必要的数据表');
    const config=JSON.parse(db.prepare("SELECT value FROM settings WHERE key='config'").get()?.value??'{}');
    if(!config.timezone)throw new Error('备份缺少统计时区');
    new Intl.DateTimeFormat('en',{timeZone:config.timezone});
    if(db.prepare('PRAGMA foreign_key_check').all().length)throw new Error('备份数据关联不完整');
    const fxRow=db.prepare("SELECT value FROM settings WHERE key='fx'").get();
    if(fxRow){const fx=JSON.parse(fxRow.value);if(!fx||typeof fx.rates!=='object'||Array.isArray(fx.rates)||!fx.rates)throw new Error('备份汇率格式无效');for(const [code,row] of Object.entries(fx.rates)){if(!/^[A-Z]{3}$/.test(code)||!row||!Number.isFinite(row.rate)||row.rate<=0||row.rate>1e12)throw new Error('备份汇率无效');}}
  }catch(e){e.status=400;throw e;}finally{db.close();}
  return archive;
}
