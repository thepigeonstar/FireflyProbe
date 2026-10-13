import {existsSync,readFileSync,realpathSync} from 'node:fs';
import {join,relative,isAbsolute} from 'node:path';

// Registry and modules are trusted application source installed by the operator.
export function loadPlugins(directory){
 const modules=new Map(),file=join(directory,'registry.json');if(!existsSync(file))return {list:()=>[],source:()=>undefined};
 const root=realpathSync(directory),entries=JSON.parse(readFileSync(file,'utf8'));if(!Array.isArray(entries)||entries.length>30)throw Error('插件注册表需为最多 30 项的数组');
 for(const item of entries){
  if(!item||typeof item!=='object'||!/^[a-z][a-z0-9-]{0,39}$/.test(item.id||'')||modules.has(item.id)||typeof item.name!=='string'||!item.name.trim()||item.name.length>60||typeof item.description!=='string'||item.description.length>240||typeof item.version!=='string'||item.version.length>32||typeof item.entry!=='string'||!/^([a-zA-Z0-9_-]+\/)*[a-zA-Z0-9_-]+\.js$/.test(item.entry))throw Error('插件注册表格式无效');
  const path=realpathSync(join(root,item.entry)),inside=relative(root,path);if(isAbsolute(inside)||inside==='..'||inside.startsWith('../')||inside.startsWith('..\\'))throw Error('插件文件必须位于插件目录');
  const source=readFileSync(path,'utf8');if(Buffer.byteLength(source)>512*1024)throw Error('插件模块超过 512 KiB');modules.set(item.id,{metadata:{id:item.id,name:item.name,description:item.description,version:item.version},source});
 }
 return {list:()=>[...modules.values()].map(p=>({...p.metadata})),source:id=>modules.get(id)?.source};
}
