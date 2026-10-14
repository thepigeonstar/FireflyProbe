import ssh2 from 'ssh2';
const { Client }=ssh2;
import { createCipheriv, createDecipheriv, randomBytes, createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { isIP } from 'node:net';
import {domainToASCII} from 'node:url';
import { join } from 'node:path';

const error = (status,message) => Object.assign(new Error(message),{status});
export const fingerprint = key => 'SHA256:'+createHash('sha256').update(key).digest('base64').replace(/=+$/,'');
export function createVault(directory) {
  const file=join(directory,'ssh-secret.key');
  try {writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});}catch(e){if(e.code!=='EEXIST')throw e;}
  chmodSync(file,0o600);
  const key=readFileSync(file);if(key.length!==32)throw new Error('SSH 加密密钥文件无效');
  return vaultFromKey(key);
}
export function vaultFromKey(key){
  if(!Buffer.isBuffer(key)||key.length!==32)throw new Error('凭据密钥无效');
  return {
    seal(value,id){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(Buffer.from(id));const body=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),body]).toString('base64');},
    open(value,id){try{const blob=Buffer.from(value,'base64'),cipher=createDecipheriv('aes-256-gcm',key,blob.subarray(0,12));cipher.setAAD(Buffer.from(id));cipher.setAuthTag(blob.subarray(12,28));return Buffer.concat([cipher.update(blob.subarray(28)),cipher.final()]).toString('utf8');}catch{throw error(409,'SSH 凭据无法解密，请重新填写密码；迁移主控时需同时迁移 ssh-secret.key');}}
  };
}
export function sshFields(input,old={}) {
  let host=input.ssh_host??old.ssh_host??'';const port=input.ssh_port??old.ssh_port??22,user=input.ssh_user??old.ssh_user??'root';
  if(typeof host!=='string')throw error(400,'SSH 地址请填写 IP 或域名，端口单独填写');
  host=host.trim();if(host&&!isIP(host)){
    if(/[\s/:@?#\\]/.test(host)||/^[0-9.]+$/.test(host))throw error(400,'SSH 地址请填写 IP 或域名，端口单独填写');
    host=domainToASCII(host.replace(/\.$/,'')).toLowerCase();
    if(!host||host.length>253||host.split('.').length<2||host.split('.').some(label=>!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)))throw error(400,'SSH 域名格式无效');
  }
  if(!Number.isInteger(port)||port<1||port>65535)throw error(400,'SSH 端口无效');
  if(typeof user!=='string'||!/^[_a-zA-Z][_a-zA-Z0-9.-]{0,63}$/.test(user))throw error(400,'SSH 用户名无效');
  return {ssh_host:host,ssh_port:port,ssh_user:user};
}
export function createSSH({db,vault,publicURL,bootstrap,ClientClass=Client}) {
  const drafts=new Map(),jobs=new Map(),probes=new Map(),connections=new Set();let stopped=false;
  const node=id=>{const n=db.prepare('SELECT * FROM nodes WHERE id=?').get(id);if(!n)throw error(404,'服务器不存在');return n;};
  const config=n=>{if(!n.ssh_host)throw error(400,'请先保存服务器 IP 或域名及 SSH 配置');return {host:n.ssh_host,port:n.ssh_port,username:n.ssh_user,readyTimeout:15000,keepaliveInterval:10000,keepaliveCountMax:3};};
  const friendly=e=>/authentication/i.test(e.message)?'SSH 登录失败，请检查用户名、密码和服务器密码登录设置':/host|fingerprint/i.test(e.message)?'SSH 指纹不匹配，请重新测试并核对服务器身份':/timed out|timeout/i.test(e.message)?'SSH 连接或部署超时，请检查网络、防火墙和 SSH 端口':/ECONNREFUSED/.test(e.message)?'SSH 端口拒绝连接':/ENETUNREACH|EHOSTUNREACH/.test(e.message)?'主控无法访问该服务器':'SSH 操作失败，请检查服务器 SSH 服务与网络';
  function connect(n,scan=false){return new Promise((resolve,reject)=>{
    if(stopped)return reject(error(503,'SSH 服务正在停止'));
    if(connections.size>=4)return reject(error(429,'SSH 操作较多，请稍后重试'));
    let captured='',done=false;
    const c=new ClientClass(),finish=(err,value)=>{if(done)return;done=true;clearTimeout(timer);if(scan||err)c.destroy();err?reject(err):resolve(value);};
    const timer=setTimeout(()=>finish(error(504,'SSH 连接超时')),18000);timer.unref();connections.add(c);
    c.on('close',()=>{connections.delete(c);if(!done)finish(error(502,'SSH 连接已断开'));});
    c.on('error',e=>{if(scan&&captured)finish(null,captured);else finish(error(502,friendly(e)));});
    c.on('ready',()=>finish(null,c));
    try{c.connect({...config(n),password:scan?'':vault.open(n.ssh_password,n.id),hostVerifier:key=>{captured=fingerprint(key);if(scan){finish(null,captured);return false;}return captured===n.ssh_fingerprint;}});}catch(e){finish(e.status?e:error(502,friendly(e)));}
  });}
  function exec(c,command,input='',timeout=30000,onLine=()=>{}){return new Promise((resolve,reject)=>{
    let done=false,partial='';const finish=(e,code)=>{if(done)return;done=true;clearTimeout(timer);if(e)c.destroy();e?reject(e):resolve(code);};
    const timer=setTimeout(()=>finish(error(504,'远程操作超时')),timeout);timer.unref();
    const consume=chunk=>{partial+=chunk.toString();if(partial.length>32768)partial=partial.slice(-32768);const lines=partial.split(/\r?\n/);partial=lines.pop();for(const line of lines)onLine(line);};
    c.once('close',()=>finish(error(502,'SSH 连接中断')));
    c.exec(command,(e,stream)=>{if(e)return finish(error(502,'无法执行远程命令'));stream.on('data',consume);stream.stderr.on('data',consume);stream.on('error',()=>finish(error(502,'远程命令中断')));stream.on('close',code=>{if(partial)onLine(partial);finish(null,code);});stream.end(input);});
  });}
  const status=id=>{const job=jobs.get(id);if(!job)throw error(404,'部署任务不存在');return {...job};};
  const busy=id=>[...jobs.values()].some(j=>j.node_id===id&&j.status==='running');
  return {
    busy,
    runManaged(id,script,onComplete){
      const n=node(id);
      if(!n.ssh_fingerprint||!n.ssh_password)throw error(400,'请先配置 SSH、测试连接并确认指纹');
      if(busy(id)||[...jobs.values()].filter(j=>j.status==='running').length>=2)throw error(409,'已有 SSH 任务正在进行，请稍后重试');
      const password=vault.open(n.ssh_password,id),job={id:randomUUID(),node_id:id,status:'running',created:Math.floor(Date.now()/1000),finished:0,log:'正在连接 SSH…\n'};
      jobs.set(job.id,job);for(const [key,value] of jobs)if(value.status!=='running'&&jobs.size>100)jobs.delete(key);
      (async()=>{let c;try{c=await connect(n);const code=await exec(c,n.ssh_user==='root'?'sh -s':'sudo -n sh -s',script,600000,line=>{job.log=(job.log+line.replaceAll(password,'[已隐藏]').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'')+'\n').slice(-65536);});job.status=code===0?'success':'failed';job.log+=code===0?'操作完成。\n':`操作失败（退出码 ${code??'未知'}）。\n`;}catch(e){job.status='failed';job.log+=(e.status?e.message:friendly(e))+'\n';}finally{c?.end();job.finished=Math.floor(Date.now()/1000);try{onComplete?.({...job});}catch{job.status='failed';job.log+='无法保存操作结果，请核对远端服务状态。\n';}}})();
      return {...job};
    },
    async draftProbe(input,owner){
      const old=input.id?node(input.id):{},fields=sshFields(input,old),id=randomUUID();
      if(typeof input.ssh_password!=='string'||input.ssh_password.length>1024||input.ssh_password.includes('\0'))throw error(400,'SSH 密码格式无效');
      const password=input.ssh_clear?'':input.ssh_password||(old.ssh_password?vault.open(old.ssh_password,old.id):'');if(!password)throw error(400,'请填写 SSH 密码');
      const n={id,...fields,ssh_password:vault.seal(password,id)},key=await connect(n,true);
      for(const [key,value] of drafts)if(Date.now()-value.time>120000)drafts.delete(key);if(drafts.size>=100)drafts.delete(drafts.keys().next().value);
      drafts.set(id,{owner,n:{...n,ssh_fingerprint:key},time:Date.now()});
      return {challenge:id,fingerprint:key,trusted:old.ssh_host===fields.ssh_host&&old.ssh_port===fields.ssh_port&&old.ssh_fingerprint===key};
    },
    async draftTest(input,owner){const draft=drafts.get(input.challenge);if(!draft||draft.owner!==owner||Date.now()-draft.time>120000||draft.n.ssh_fingerprint!==input.fingerprint)throw error(409,'测试指纹已过期，请重新测试');drafts.delete(input.challenge);const c=await connect(draft.n);let output='';try{const code=await exec(c,'id -u','',30000,line=>output+=line);if(code!==0)throw error(502,'SSH 已连接，但无法执行检测命令');return {ok:true,root:output.trim()==='0',message:output.trim()==='0'?'SSH 连接成功，可安装/更新；配置尚未保存':'SSH 连接成功；安装/更新需要 root 或免密 sudo，配置尚未保存'};}finally{c.end();}},
    recent(id){const job=[...jobs.values()].filter(j=>j.node_id===id).at(-1);return job?{id:job.id,status:job.status,created:job.created}:null;},
    async probe(id){const n=node(id),key=await connect(n,true);probes.set(id,{key,host:n.ssh_host,port:n.ssh_port,time:Date.now()});return {fingerprint:key,trusted:key===n.ssh_fingerprint};},
    trust(id,key){const n=node(id),p=probes.get(id);if(!p||Date.now()-p.time>120000||p.host!==n.ssh_host||p.port!==n.ssh_port||p.key!==key)throw error(409,'指纹确认已过期，请重新测试连接');db.prepare('UPDATE nodes SET ssh_fingerprint=? WHERE id=?').run(key,id);probes.delete(id);},
    async test(id){const n=node(id);if(!n.ssh_fingerprint||!n.ssh_password)throw error(400,'请保存密码并确认 SSH 指纹');const c=await connect(n);let output='';try{const code=await exec(c,'id -u', '',30000,line=>output+=line);if(code!==0)throw error(502,'SSH 已连接，但无法执行检测命令');return {ok:true,root:output.trim()==='0',message:output.trim()==='0'?'SSH 连接成功，可一键部署':'SSH 连接成功；一键部署需要 root 或免密 sudo'};}finally{c.end();}},
    deploy(id){
      const n=node(id);if(!n.enabled)throw error(400,'请先启用服务器');if(!n.ssh_fingerprint||!n.ssh_password)throw error(400,'请先测试连接并确认 SSH 指纹');
      if(!/^https:\/\/[a-zA-Z0-9.-]+(?::\d+)?\/?$/.test(publicURL))throw error(400,'SSH 部署需要有效的 HTTPS PUBLIC_URL');
      if(busy(id)||[...jobs.values()].filter(j=>j.status==='running').length>=2)throw error(409,'已有部署任务正在进行，请稍后重试');
      vault.open(n.ssh_password,id);
      // New nodes retain their token encrypted; existing installations upgrade with their local config.
      const secret=n.agent_secret?vault.open(n.agent_secret,id):'';
      const job={id:randomUUID(),node_id:id,status:'running',created:Math.floor(Date.now()/1000),finished:0,log:'正在连接 SSH…\n'};jobs.set(job.id,job);
      for(const [key,value] of jobs)if(value.status!=='running'&&(jobs.size>100||Date.now()/1000-value.created>3600))jobs.delete(key);
      const redact=line=>{for(const s of [secret,vault.open(n.ssh_password,id)])if(s)line=line.replaceAll(s,'[已隐藏]');return line.replace(/[a-f0-9]{64}/g,'[已隐藏密钥]').replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');};
      const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
      const script=`set -eu\nif [ -f /etc/lightprobe-agent.json ]; then\n set -- --upgrade --server ${quote(publicURL)}${secret?" --token "+quote(secret):""}\nelse\n [ -n ${quote(secret)} ] || { echo '旧节点未保留安装密钥：请在详情重新生成密钥后重试部署。'; exit 1; }\n set -- --server ${quote(publicURL)} --token ${quote(secret)}\nfi\n${bootstrap}\nif command -v rc-service >/dev/null && [ -f /etc/init.d/lightprobe-agent ]; then rc-service lightprobe-agent status; else systemctl is-active --quiet lightprobe-agent; fi\necho '采集端服务已启动，请等待主控收到上报。'\n`;
      (async()=>{let c;try{c=await connect(n);const command=n.ssh_user==='root'?'sh -s':'sudo -n sh -s';job.log+='SSH 已连接，正在安装或更新采集端…\n';const code=await exec(c,command,script,600000,line=>{job.log=(job.log+redact(line)+'\n').slice(-65536);});job.status=code===0?'success':'failed';job.log+=code===0?'部署完成；在线状态以采集端上报为准。\n':`部署失败（退出码 ${code??'未知'}），请检查上述日志。\n`;}catch(e){job.status='failed';job.log+=(e.status?e.message:friendly(e))+'\n';}finally{c?.end();job.finished=Math.floor(Date.now()/1000);}})();
      return status(job.id);
    },
    status,
    cancelAll(){drafts.clear();stopped=true;for(const c of connections)c.destroy();for(const job of jobs.values())if(job.status==='running'){job.status='failed';job.finished=Math.floor(Date.now()/1000);job.log+='主控停止或恢复备份，任务已中止；请核对受控端状态。\n';}},
    reset(){drafts.clear();probes.clear();stopped=false;}
  };
}
