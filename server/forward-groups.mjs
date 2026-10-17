import {randomUUID} from 'node:crypto';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export function createForwardGroups(db){
 const nodes=()=>db.prepare('SELECT id FROM nodes').all().map(n=>n.id);
 const list=()=>{const valid=new Set(nodes()),row=db.prepare("SELECT value FROM settings WHERE key='forward_groups'").get();return (row?JSON.parse(row.value):[]).map(g=>({...g,node_ids:g.node_ids.filter(id=>valid.has(id))}));};
 const save=groups=>db.prepare("INSERT INTO settings VALUES('forward_groups',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(groups));
 return {list,scope(id){const groups=list();if(id==='ungrouped'){const used=new Set(groups.flatMap(g=>g.node_ids));return nodes().filter(id=>!used.has(id));}const g=groups.find(g=>g.id===id);if(!g)fail('分组不存在');return g.node_ids;},
  write(input,id){const groups=list(),existing=id&&groups.find(g=>g.id===id);if(id&&!existing)fail('分组不存在');const name=input?.name;if(typeof name!=='string'||!name.trim()||name.trim().length>40||/[\x00-\x1f]/.test(name))fail('分组名称需为 1–40 个字符');if(groups.some(g=>g.id!==id&&g.name===name.trim()))fail('分组名称已存在');if(!id&&groups.length>=40)fail('最多 40 个分组');const ids=input.node_ids,valid=new Set(nodes());if(!Array.isArray(ids)||ids.length>200||new Set(ids).size!==ids.length||ids.some(n=>!valid.has(n)))fail('请选择有效服务器，不能重复');
   const group={id:id||randomUUID(),name:name.trim(),node_ids:ids};for(const g of groups)g.node_ids=g.node_ids.filter(n=>!ids.includes(n));if(existing)Object.assign(existing,group);else groups.push(group);save(groups);return group;},
  remove(id){const groups=list();if(!groups.some(g=>g.id===id))fail('分组不存在');save(groups.filter(g=>g.id!==id));return {ok:true};}};
}
