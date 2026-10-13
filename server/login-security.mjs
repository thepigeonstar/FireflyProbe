import {BlockList,isIP} from 'node:net';
import {readFileSync} from 'node:fs';
import {lookup} from 'node:dns/promises';

export const normalizeIP=value=>{const text=String(value||'').trim().replace(/^::ffff:/i,'');return isIP(text)?text:'';};
export function proxyPolicy(spec){
 const list=new BlockList();
 for(const value of String(spec).split(',').map(x=>x.trim()).filter(Boolean)){
  const [address,prefix,...extra]=value.split('/'),ip=normalizeIP(address),type=isIP(ip)===4?'ipv4':'ipv6',max=type==='ipv4'?32:128;
  if(!ip||extra.length||prefix!==undefined&&(!/^\d+$/.test(prefix)||Number(prefix)>max))throw Error('TRUSTED_PROXIES 配置无效，请填写 IP 或 CIDR');
  if(prefix===undefined)list.addAddress(ip,type);else list.addSubnet(ip,Number(prefix),type);
 }
 return value=>{const ip=normalizeIP(value);return Boolean(ip&&list.check(ip,isIP(ip)===4?'ipv4':'ipv6'));};
}
function dockerGateway(){try{for(const row of readFileSync('/proc/net/route','utf8').split('\n').slice(1)){const fields=row.trim().split(/\s+/);if(fields[1]==='00000000'&&/^[0-9A-F]{8}$/i.test(fields[2]||'')){const ip=fields[2].match(/../g).reverse().map(x=>parseInt(x,16)).join('.');if(/^172\.(1[6-9]|2\d|3[01])\./.test(ip))return ip;}}}catch{}return '';}
export function forwardedClientIP(peer,header,trusted){
 peer=normalizeIP(peer)||'unknown';if(!trusted(peer)||typeof header!=='string'||header.length>1024)return peer;
 const chain=header.split(',').map(normalizeIP);if(!chain.length||chain.length>20||chain.some(ip=>!ip))return peer;
 let current=peer;for(let i=chain.length-1;i>=0&&trusted(current);i--)current=chain[i];return current;
}
export function createClientIP(spec=process.env.TRUSTED_PROXIES){
 const automatic=spec===undefined,configured=proxyPolicy(spec??'127.0.0.1/32,::1/128'),gateway=automatic?dockerGateway():'',dockerIPs=new Set(gateway?[gateway]:[]);let resolvedAt=0,pending;
 // Only the actual Docker gateway and named companion Caddy are auto-trusted,
 // never an entire private network. Explicit TRUSTED_PROXIES overrides discovery.
 async function refreshCaddy(){if(!automatic||!gateway||Date.now()-resolvedAt<60000)return;resolvedAt=Date.now();pending??=lookup('caddy',{all:true}).then(rows=>{dockerIPs.clear();dockerIPs.add(gateway);for(const row of rows){const ip=normalizeIP(row.address);if(/^172\.(1[6-9]|2\d|3[01])\./.test(ip))dockerIPs.add(ip);}}).catch(()=>{}).finally(()=>pending=null);await pending;}
 return async req=>{const peer=normalizeIP(req.socket.remoteAddress);if(automatic&&gateway&&!configured(peer)&&!dockerIPs.has(peer))await refreshCaddy();return forwardedClientIP(peer,req.headers['x-forwarded-for'],ip=>configured(ip)||dockerIPs.has(ip));};
}
export function createLoginLimiter(clock=()=>Date.now()){
 const ips=new Map(),accounts=new Map(),window=300000;
 function entry(map,key){const stamp=clock();let value=map.get(key);if(!value||stamp>=value.until){if(map.size>=1000)map.delete(map.keys().next().value);value={count:0,until:stamp+window};map.set(key,value);}return value;}
 return {
  attempt(ip,username){const rate=entry(ips,ip);if(++rate.count>15)throw Object.assign(Error('登录尝试过多，请五分钟后再试'),{status:429});const account=entry(accounts,String(username||'').slice(0,64).toLowerCase());return Math.min(750,Math.max(0,account.count-5)*50);},
  result(username,valid){const key=String(username||'').slice(0,64).toLowerCase();if(valid)accounts.delete(key);else entry(accounts,key).count++;},
  prune(){for(const map of [ips,accounts])for(const [key,value] of map)if(clock()>=value.until)map.delete(key);}
 };
}
