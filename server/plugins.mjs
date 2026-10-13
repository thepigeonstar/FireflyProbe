import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';
import {createHash} from 'node:crypto';
import {requestedPermissions} from './plugin-access.mjs';

const invalid=message=>Object.assign(new Error(message),{status:400});
export function validatePluginPackage(value){
 const m=value?.manifest;
 if(value?.format!=='firefly-plugin'||value.api_version!==1||!m||!/^[a-z][a-z0-9-]{0,39}$/.test(m.id||'')||typeof m.name!=='string'||!m.name.trim()||m.name.length>60||typeof m.description!=='string'||m.description.length>240||typeof m.version!=='string'||m.version.length>32||typeof value.source!=='string'||!value.source.trim()||Buffer.byteLength(value.source)>128*1024)throw invalid('插件包无效：需为 Firefly 插件接口 1，代码不超过 128 KiB');
 return {format:'firefly-plugin',api_version:1,manifest:{id:m.id,name:m.name.trim(),description:m.description,version:m.version,permissions:requestedPermissions(m.permissions)},source:value.source};
}
export function createPlugins(directory,db){
 const builtin=loadPlugins(directory),uploads=()=>db.prepare("SELECT key,value FROM settings WHERE key LIKE 'plugin:%'").all().map(row=>validatePluginPackage(JSON.parse(row.value)));
 const metadata=p=>({...p.manifest,uploaded:true,revision:createHash('sha256').update(p.source+JSON.stringify(p.manifest.permissions)).digest('hex')});
 return {
  list:()=>[...builtin.list().map(p=>({...p,permissions:requestedPermissions(p.permissions),revision:createHash('sha256').update(builtin.source(p.id)+JSON.stringify(requestedPermissions(p.permissions))).digest('hex')})),...uploads().map(metadata)],
  source:id=>uploads().find(p=>p.manifest.id===id)?.source??builtin.source(id),
  install(input,replace=false){const p=validatePluginPackage(input),key='plugin:'+p.manifest.id;if(builtin.list().some(x=>x.id===p.manifest.id))throw Object.assign(new Error('与内置插件 ID 冲突，请更换 ID'),{status:409});const existing=db.prepare('SELECT 1 FROM settings WHERE key=?').get(key);if(existing&&!replace)throw Object.assign(new Error('同名插件已存在，确认后可覆盖更新'),{status:409});if(!existing&&this.list().length>=30)throw invalid('最多安装 30 个插件');db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,JSON.stringify(p));return metadata(p);},
  remove(id){if(!/^[a-z][a-z0-9-]{0,39}$/.test(id))throw invalid('插件 ID 无效');const result=db.prepare('DELETE FROM settings WHERE key=?').run('plugin:'+id);if(!result.changes)throw Object.assign(new Error('未找到可删除的上传插件'),{status:404});db.prepare('DELETE FROM settings WHERE key=?').run('plugin_grants:'+id);}
 };
}

// Registry and modules are trusted application source installed by the operator.
export function loadPlugins(directory){
 const modules=new Map(),file=join(directory,'registry.json');if(!existsSync(file))return {list:()=>[],source:()=>undefined};
 const root=realpathSync(directory),entries=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(entries)||entries.length>30)throw Error('插件注册表需为最多 30 项的数组');
 for(const item of entries){
  if(!item||typeof item!=='object'||!/^[a-z][a-z0-9-]{0,39}$/.test(item.id||'')||modules.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>60||typeof item.description!=='string'||item.description.length>240||typeof item.version!=='string'||item.version.length>32||typeof item.entry!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js$/.test(item.entry))throw Error('插件注册表格式无效');
  const path=realpathSync(join(root,item.entry)),inside=relative(root,path);if(isAbsolute(inside)||inside==='..'||inside.startsWith('../')||inside.startsWith('..\\'))throw Error('插件文件必须位于插件目录');
  const source=readFileSync(path,'utf8');if(Buffer.byteLength(source)>512*1024)throw Error('插件模块超过 512 KiB');modules.set(item.id,{metadata:{id:item.id,name:item.name,description:item.description,version:item.version,permissions:requestedPermissions(item.permissions)},source});
 }
 return {list:()=>[...modules.values()].map(p=>({...p.metadata})),source:id=>modules.get(id)?.source};
}
