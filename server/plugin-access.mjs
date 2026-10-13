import {createHash,randomUUID} from 'node:crypto';
export const pluginScopes={
 'monitor.read':'读取服务器监控','traffic.read':'读取历史流量','costs.read':'读取费用',
 'nodes.manage':'添加、修改和删除服务器资料','notifications.send':'发送 Telegram 通知','ssh.deploy':'测试 SSH、安装或更新采集端'
};
const fail=(status,message)=>Object.assign(Error(message),{status});
export function requestedPermissions(value){const permissions=value??['monitor.read'];if(!Array.isArray(permissions)||permissions.length>6||permissions.some(p=>!Object.hasOwn(pluginScopes,p))||new Set(permissions).size!==permissions.length)throw fail(400,'插件权限声明无效');return permissions;}
const nodeFields=new Set(['name','group_name','interface','sort','quota','billing_day','billing_mode','expires','enabled','cost_amount','cost_currency','cost_months','cost_active','alerts_enabled','maintenance_until','public_visible','country_override']);
export function pluginOperation(input){
 if(typeof input?.path!=='string'||!input.path.startsWith('/api/')||input.path.length>500||/[\x00-\x20\x7f\\]/.test(input.path)||input.method!==undefined&&typeof input.method!=='string')throw fail(400,'插件接口路径无效');
 const url=new URL(input.path,'http://plugin.local');if(url.hash||url.origin!=='http://plugin.local')throw fail(400,'插件接口路径无效');
 const method=String(input.method||'GET').toUpperCase(),path=url.pathname,query=url.searchParams,id='[a-f0-9-]{36}';let scope;
 if(method==='GET'){
  if(path==='/api/nodes'&&!url.search)scope='monitor.read';
  else if(path==='/api/costs'&&!url.search)scope='costs.read';
  else if(path==='/api/traffic/history'){const allowed=new Set(['days','period','node']);if([...query.keys()].some(k=>!allowed.has(k))||[...query.keys()].length!==new Set(query.keys()).size)throw fail(400,'流量查询参数无效');scope='traffic.read';}
  else if(path==='/api/network/history'&&!url.search||new RegExp('^/api/nodes/'+id+'/network-history$').test(path)&&!url.search)scope='traffic.read';
  else if(new RegExp('^/api/nodes/'+id+'/history$').test(path)&&[...query.keys()].every(k=>k==='hours')&&query.getAll('hours').length<=1)scope='traffic.read';
 }else if(!url.search){
  if(method==='POST'&&path==='/api/nodes'||['PUT','DELETE'].includes(method)&&new RegExp('^/api/nodes/'+id+'$').test(path)){scope='nodes.manage';if(method!=='DELETE'&&(!input.data||Array.isArray(input.data)||typeof input.data!=='object'||Object.keys(input.data).some(k=>!nodeFields.has(k))))throw fail(400,'插件不能设置 SSH 凭据或其他敏感字段');}
  else if(method==='POST'&&path==='/api/notifications/send'){scope='notifications.send';if(typeof input.data?.message!=='string'||!input.data.message.trim()||input.data.message.length>3000)throw fail(400,'通知内容需为 1–3000 个字符');}
  else if(method==='POST'&&new RegExp('^/api/nodes/'+id+'/ssh/(probe|trust|test|deploy)$').test(path)){scope='ssh.deploy';if(path.endsWith('/trust')&&typeof input.data?.fingerprint!=='string')throw fail(400,'缺少 SSH 指纹');}
 }
 if(!scope)throw fail(403,'插件无权使用此接口');return {path:url.pathname+url.search,method,data:method==='GET'?undefined:input.data,scope,mutation:method!=='GET'};
}
export function createPluginAccess(db,plugins){
 const approvals=new Map();
 function record(id){const p=plugins.list().find(p=>p.id===id);if(!p)throw fail(404,'插件不存在');const requested=requestedPermissions(p.permissions),raw=db.prepare('SELECT value FROM settings WHERE key=?').get('plugin_grants:'+id);let saved;try{saved=JSON.parse(raw?.value||'null');if(saved)requestedPermissions(saved.permissions);}catch{saved=null;}const granted=saved?.revision===p.revision?requested.filter(x=>saved.permissions.includes(x)):requested.filter(x=>x==='monitor.read');return {requested,granted,revision:p.revision};}
 function check(id,input){const access=record(id),operation=pluginOperation(input);if(!access.granted.includes(operation.scope))throw fail(403,'管理员尚未授予此插件所需权限');return {...operation,revision:access.revision};}
 const hash=operation=>createHash('sha256').update(JSON.stringify(operation)).digest('hex');
 return {
  view:record,
  grant(id,permissions){requestedPermissions(permissions);const r=record(id);if(permissions.some(p=>!r.requested.includes(p)))throw fail(400,'不能授予插件未声明的权限');db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run('plugin_grants:'+id,JSON.stringify({revision:r.revision,permissions}));for(const [key,a] of approvals)if(a.id===id)approvals.delete(key);return record(id);},
  approve(id,input,owner){const op=check(id,input);if(!op.mutation)throw fail(400,'读取操作不需要确认');if(approvals.size>=500)approvals.delete(approvals.keys().next().value);const token=randomUUID();approvals.set(token,{id,owner,hash:hash(op),until:Date.now()+120000});return {approval:token};},
  invoke(id,input,owner){const op=check(id,input);if(op.mutation){const a=approvals.get(input.approval);approvals.delete(input.approval);if(!a||a.id!==id||a.owner!==owner||a.until<Date.now()||a.hash!==hash(op))throw fail(403,'此插件操作需要管理员重新确认');}return op;},
  reset(){approvals.clear();}
 };
}
