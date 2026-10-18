import http from 'node:http';
import {isIP} from 'node:net';
import { readFileSync, createReadStream, statSync, rmSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import {createClientIP,createLoginLimiter} from './login-security.mjs';
import {loadTelegramSettings,persistTelegramSettings,withoutTelegramToken} from './telegram-secret.mjs';
import {pluginFrame,pluginNodes} from './plugin-frame.mjs';
import {createPluginAccess,pluginScopes} from './plugin-access.mjs';
import {createAgentBatch} from './agent-batch.mjs';
import {createForwarding,forwardURLs,gostVersion} from './forwarding.mjs';
import {createForwardBatch} from './forward-batch.mjs';
import {createForwardAlerts} from './forward-alerts.mjs';
import {publicNodeName} from './public-name.mjs';
import {createForwardGroups} from './forward-groups.mjs';
import {forwardServerHistory} from './forward-history.mjs';
import {dailyReportLines} from './daily-report.mjs';
import {forwardDiagnosticScript} from './forward-diagnostic.mjs';
import {renewOnlineNodes} from './auto-renew.mjs';
import {expiryView,renewManually} from './manual-renew.mjs';
import {trafficHistory} from './traffic-history.mjs';
import { openStore, dayKey, validDate, dailyTotals } from './store.mjs';
import { brandDefaults, brandView, validateBrand } from './brand.mjs';
import { createRates, nodeCost, costSummary } from './costs.mjs';
import { alarmDefaults, inQuiet, processAlarms } from './alarms.mjs';
import { createBackups, backupName, receiveRestore } from './backups.mjs';
import { createVault, vaultFromKey, createSSH, sshFields } from './ssh.mjs';
import {notificationSelected,validateTargets} from './notification-targets.mjs';
import {networkChart} from './network-chart.mjs';
import {createPlugins,validatePluginPackage} from './plugins.mjs';
import {createRemoteBackup,parseDriveConfig,remoteFields} from './remote-backup.mjs';
import {createAccount,validatePaths} from './account.mjs';

export function publicIP(value){const ip=String(value||'').replace(/^::ffff:/,'');if(!isIP(ip))return '';if(isIP(ip)===4){const [a,b]=ip.split('.').map(Number);if(a===0||a===10||a===127||a>=224||a===169&&b===254||a===172&&b>=16&&b<=31||a===192&&b===168||a===100&&b>=64&&b<=127||a===198&&(b===18||b===19))return '';}else if(!/^[23][0-9a-f]{3}:/i.test(ip))return '';return ip;}
export function reportIP(req,node){const peer=String(req.socket.remoteAddress||'').replace(/^::ffff:/,'');const direct=publicIP(peer);if(direct)return direct;const local=peer==='127.0.0.1'||peer==='::1'||/^172\.(1[6-9]|2\d|3[01])\./.test(peer);if(local){const forwarded=String(req.headers['x-forwarded-for']||'').split(',').at(-1)?.trim();if(publicIP(forwarded))return publicIP(forwarded);}return publicIP(node.ssh_host);}
const sha = s => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');
const defaults = { timezone: 'Asia/Shanghai', interval: 5, offline_seconds: 45, keep_days: 180, trend_days: 7, report_enabled: false, report_hour: 8, report_minute: 0, thresholds: [80, 90, 95], telegram_token: '', telegram_chat: '' };
const staticDir = fileURLToPath(new URL('../web/', import.meta.url));
const publicFiles = new Map(['index.html', 'app.js', 'features.js','style.css','features.css','management.js','management.css','background.js','background.css','theme.js','theme.css', 'firefly.svg','public.html','public.js','plugin-host.js','remote-backup.js','traffic-history.js','forwarding.js','agent-batch.js'].map(f => [f, readFileSync(join(staticDir, f))]));
const downloads = new Map([
  ['/install-agent.sh', fileURLToPath(new URL('../agent/entry.sh', import.meta.url))],
  ['/downloads/google-auth.ps1',fileURLToPath(new URL('../tools/google-auth.ps1',import.meta.url))],
  ['/downloads/bootstrap.sh',fileURLToPath(new URL('../agent/bootstrap.sh',import.meta.url))],
  ['/downloads/install.sh', fileURLToPath(new URL('../agent/install.sh', import.meta.url))],
  ['/downloads/SHA256SUMS', fileURLToPath(new URL('../bin/SHA256SUMS', import.meta.url))],
  ...['amd64','arm64'].map(arch => [`/downloads/lightprobe-agent-linux-${arch}`, fileURLToPath(new URL(`../bin/lightprobe-agent-linux-${arch}`, import.meta.url))])
]);
const fail = (status, message) => { const e = new Error(message); e.status = status; throw e; };
function finite(v, min, max, name, integer = false) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max || (integer && !Number.isSafeInteger(v))) fail(400, `${name} 数值无效`);
  return v;
}
function textValue(v, max, name) { if (typeof v !== 'string' || v.length > max || /[\x00-\x1f]/.test(v)) fail(400, `${name} 格式无效`); return v.trim(); }
function nodeFields(data) {
  if(data.public_show_name!==undefined&&![true,false,0,1].includes(data.public_show_name))fail(400,'公开名称开关无效');
  if(data.auto_renew!==undefined&&![true,false,0,1].includes(data.auto_renew))fail(400,'自动续期开关无效');
  const n = {
    auto_renew:data.auto_renew===false||data.auto_renew===0?0:1,
    name: textValue(data.name, 80, '名称'), group_name: textValue(data.group_name ?? '', 40, '分组'),
    interface: textValue(data.interface ?? '', 40, '网卡'), sort: finite(data.sort ?? 0, -10000, 10000, '排序', true),
    quota: finite(data.quota ?? 0, 0, 8e15, '流量额度', true), billing_day: finite(data.billing_day ?? 1, 1, 31, '结算日', true),
    billing_mode: data.billing_mode ?? 'sum', expires: data.expires ?? '', enabled: data.enabled === false || data.enabled === 0 ? 0 : 1,
    cost_amount:finite(data.cost_amount??0,0,1e9,'付款金额'),cost_currency:textValue(data.cost_currency??'CNY',3,'币种').toUpperCase(),cost_months:finite(data.cost_months??1,1,120,'付款周期',true),cost_active:data.cost_active===false||data.cost_active===0?0:1,
    alerts_enabled:data.alerts_enabled===false||data.alerts_enabled===0?0:1,maintenance_until:finite(data.maintenance_until??0,0,1e12,'维护时间',true),public_visible:data.public_visible===true||data.public_visible===1?1:0,public_show_name:data.public_show_name===true||data.public_show_name===1?1:0
  };
  if (!n.name || (n.interface && !/^[a-zA-Z0-9_.:@-]+$/.test(n.interface)) || !['rx','tx','sum','max'].includes(n.billing_mode) || (n.expires && !validDate(n.expires))) fail(400, '节点配置无效');
  if(!/^[A-Z]{3}$/.test(n.cost_currency)||Math.abs(n.cost_amount*100-Math.round(n.cost_amount*100))>0.0001)fail(400,'金额最多两位小数，币种需为三位货币代码');
  return n;
}
function settingsFields(input, old) {
  const s = { ...old };
  try {Object.assign(s,validateBrand(input,old));} catch(e) {fail(400,e.message);}
  for (const k of ['timezone','telegram_token','telegram_chat']) if (input[k] !== undefined) {if(k==='telegram_token'&&!input[k])continue;s[k] = textValue(input[k], k === 'telegram_token' ? 150 : 80, k);}
  if(input.telegram_clear!==undefined){if(typeof input.telegram_clear!=='boolean')fail(400,'Token 清除选项无效');if(input.telegram_clear)s.telegram_token='';}
  try { new Intl.DateTimeFormat('en', { timeZone: s.timezone }); } catch { fail(400, '时区无效'); }
  for (const [k, min, max] of [['interval',3,60],['offline_seconds',15,600],['keep_days',40,730],['trend_days',1,30],['report_hour',0,23],['report_minute',0,59]]) if (input[k] !== undefined) s[k] = finite(input[k], min, max, k, true);
  if (s.offline_seconds < s.interval * 3) fail(400, '离线阈值至少为上报间隔的三倍');
  if (input.report_enabled !== undefined) { if (typeof input.report_enabled !== 'boolean') fail(400, '日报设置无效'); s.report_enabled = input.report_enabled; }
  if (input.thresholds !== undefined) {
    if (!Array.isArray(input.thresholds) || input.thresholds.length > 5) fail(400, '最多设置五个告警阈值');
    s.thresholds = [...new Set(input.thresholds.map(x => finite(x, 1, 100, '告警阈值', true)))].sort((a,b) => a-b);
  }
  if (s.telegram_token && !/^\d+:[A-Za-z0-9_-]+$/.test(s.telegram_token)) fail(400, 'Telegram Token 格式无效');
  if (s.telegram_chat && !/^-?\d+$/.test(s.telegram_chat)) fail(400, 'Chat ID 必须为数字');
  if (s.timezone !== old.timezone && old.timezone) fail(400, '安装后不能直接更换统计时区；请新建主控迁移，避免混用日流量');
  for(const [k,min,max] of [['cpu_threshold',1,100],['mem_threshold',1,100],['disk_threshold',1,100],['alert_duration',15,3600],['backup_keep',1,30]])if(input[k]!==undefined)s[k]=finite(input[k],min,max,k,true);
  for(const k of ['quiet_enabled','backup_enabled','public_enabled','public_show_metrics','public_show_system','public_show_traffic'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')fail(400,'开关配置无效');s[k]=input[k];}
  for(const k of ['quiet_start','quiet_end'])if(input[k]!==undefined){if(typeof input[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input[k]))fail(400,'静默时间格式无效');s[k]=input[k];}
  if(input.expiry_days!==undefined){if(!Array.isArray(input.expiry_days)||input.expiry_days.length>8)fail(400,'最多八个到期提醒时间');s.expiry_days=[...new Set(input.expiry_days.map(x=>finite(x,0,90,'提前提醒天数',true)))].sort((a,b)=>b-a);}
  if(input.notification_targets!==undefined){try{s.notification_targets=validateTargets(input.notification_targets);}catch(e){fail(400,e.message);}}
  Object.assign(s,validatePaths(input,old));
  return s;
}

for(const file of readdirSync(join(staticDir,'flags')))if(/^[a-z]{2}\.svg$/.test(file))publicFiles.set('flags/'+file,readFileSync(join(staticDir,'flags',file)));
export async function createApp(options = {}) {
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  const username = options.username ?? process.env.ADMIN_USER ?? 'admin';
  const dbPath=resolve(options.dbPath ?? join(process.env.DATA_DIR ?? 'data', 'lightprobe.sqlite'));
  const db = openStore(dbPath);let restoring=false,restoreEpoch=0,publicCache=null;const account=await createAccount(db,username,password);
  const initial = { ...defaults, ...brandDefaults,...alarmDefaults,admin_path:process.env.ADMIN_PATH||'/admin',public_path:process.env.PUBLIC_PATH||'/', timezone: process.env.TIMEZONE || defaults.timezone };
  new Intl.DateTimeFormat('en', { timeZone: initial.timezone });
  const savedSettings=db.prepare("SELECT value FROM settings WHERE key='config'").get();
  let settings = { ...initial, ...JSON.parse(savedSettings?.value ?? '{}') };
  Object.assign(settings,validatePaths({},settings));
  if(!savedSettings)db.prepare("INSERT INTO settings VALUES('config',?)").run(JSON.stringify(settings));
  const sessions = new Map(), latest = new Map(),  noticeState = new Map();
  const fx=createRates(()=>db,{disableExternal:options.disableExternal??options.disableTelegram,fetchRates:options.fetchRates});
  const backups=createBackups(()=>db,dirname(dbPath),()=>settings);
  let loggingIn = 0, workerBusy = false, closed = false,notificationGraceUntil=0;
  const secure = options.secureCookies ?? process.env.COOKIE_SECURE === 'true';
  const publicURL = options.publicURL ?? process.env.PUBLIC_URL ?? '';
  if (secure && !publicURL.startsWith('https://')) throw new Error('安全 Cookie 模式需要 HTTPS PUBLIC_URL');
  let appOrigin = publicURL ? new URL(publicURL).origin : '';
  const vault=createVault(dirname(dbPath));
  db.exec('PRAGMA secure_delete=ON');loadTelegramSettings(db,vault,settings);
  const clientIP=createClientIP(options.trustedProxies),loginLimiter=createLoginLimiter();
  const plugins=createPlugins(options.pluginDirectory??join(staticDir,'plugins'),db);
  const pluginAccess=createPluginAccess(db,plugins),pluginCalls=new Map();
  const ssh=createSSH({db,vault,publicURL,bootstrap:readFileSync(fileURLToPath(new URL('../agent/entry.sh',import.meta.url)),'utf8'),ClientClass:options.sshClient});
  const forwarding=createForwarding(db,ssh,()=>settings.timezone);
  const forwardGroups=createForwardGroups(db);
  const forwardAlerts=createForwardAlerts(db);
  const forwardBatch=createForwardBatch(forwarding,ssh,()=>db.prepare('SELECT * FROM nodes ORDER BY sort,name').all());
  const agentBatch=createAgentBatch(ssh,()=>db.prepare('SELECT * FROM nodes ORDER BY sort,name').all());
  function configuredNode(input,old={},id=old.id) {
    const fields={...nodeFields({...old,...input}),...sshFields(input,old)};fields.renewal_anchor_day=fields.expires?(fields.expires!==old.expires?Number(fields.expires.slice(-2)):old.renewal_anchor_day||Number(fields.expires.slice(-2))):0;
    if(id&&forwarding.hasNode(id)&&(fields.ssh_host!==old.ssh_host||fields.ssh_port!==old.ssh_port||fields.ssh_user!==old.ssh_user))fail(409,'请先停止并删除转发规则，再更换 SSH 地址、端口或用户名');
    if(id&&input.ssh_clear===true&&forwarding.hasNode(id))fail(409,'请先停止并删除转发规则，再清除 SSH 密码');
    if(input.ssh_password!==undefined){if(typeof input.ssh_password!=='string'||input.ssh_password.length>1024||input.ssh_password.includes('\0'))fail(400,'SSH 密码格式无效');if(input.ssh_password)fields.ssh_password=vault.seal(input.ssh_password,id);}
    if(input.country_override!==undefined){const code=input.country_override;if(typeof code!=='string'||code!==''&&(!/^[A-Z]{2}$/.test(code)||!publicFiles.has('flags/'+code.toLowerCase()+'.svg')))fail(400,'请选择有效国家，或自动识别');fields.country_override=code;}
    if(input.ssh_clear===true)fields.ssh_password='';
    if(fields.ssh_host!==(old.ssh_host??'')||fields.ssh_port!==(old.ssh_port??22))fields.ssh_fingerprint='';
    return fields;
  }
  const remoteBackup=createRemoteBackup({db,dataDir:dirname(dbPath),vault,backups,runRclone:options.runRclone,blocked:()=>restoring||backups.busy||(agentBatch.busy||forwardBatch.busy||getNodes().some(n=>ssh.busy(n.id))),beforeSnapshot:()=>{for(const [id,l] of latest){flushMinute(id,l);db.prepare('UPDATE nodes SET last_seen=?,last_version=? WHERE id=?').run(l.received,l.metrics.version,id);}}});
  const now = () => Math.floor(Date.now()/1000);
  const geoPending=new Map(),geoAttempts=new Map();let geoActive=0;
  function countryQueue(id,ip){if(!ip||closed||options.disableExternal)return;const n=db.prepare('SELECT country_ip,country_code,country_override FROM nodes WHERE id=?').get(id);if(!n||n.country_override||n.country_ip===ip&&n.country_code)return;const prior=geoAttempts.get(id);if(prior&&prior.ip===ip&&Date.now()-prior.time<3600000)return;geoAttempts.set(id,{ip,time:Date.now()});geoPending.set(id,ip);countryDrain();}
  function countryDrain(){while(!closed&&geoActive<2&&geoPending.size){const [id,ip]=geoPending.entries().next().value;geoPending.delete(id);geoActive++;const epoch=restoreEpoch;(async()=>{try{const data=options.countryLookup?await options.countryLookup(ip):await fetch('https://api.country.is/'+encodeURIComponent(ip),{signal:AbortSignal.timeout(4000)}).then(r=>{if(!r.ok)throw Error('lookup');return r.json();});if(!closed&&!restoring&&epoch===restoreEpoch&&/^[A-Z]{2}$/.test(data.country||'')&&publicFiles.has('flags/'+data.country.toLowerCase()+'.svg')){db.prepare('UPDATE nodes SET country_code=?,country_ip=? WHERE id=?').run(data.country,ip,id);publicCache=null;}}catch{}finally{geoActive--;countryDrain();}})();}}
  const getNodes = () => db.prepare('SELECT * FROM nodes ORDER BY sort,name').all();
  const safeSettings = () => ({ ...settings,admin_user:account.username, brand_logo:undefined, brand_favicon:undefined, telegram_token: undefined, telegram_configured: Boolean(settings.telegram_token && settings.telegram_chat) });
  const editableSettings = () => ({ ...withoutTelegramToken(settings),admin_user:account.username, telegram_configured: Boolean(settings.telegram_token && settings.telegram_chat) });
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8' }); res.end(JSON.stringify(data)); };
  const enqueue = (key, message) => {
    if (!settings.telegram_token || !settings.telegram_chat) return false;
    db.prepare('INSERT OR IGNORE INTO outbox(event_key,message,created) VALUES(?,?,?)').run(key, message.slice(0, 3500), now());
    return true;
  };
  const flushMinute = (id, live) => {
    if (!live?.aggregate) return;
    const a=live.aggregate;
    db.prepare('INSERT INTO minutes VALUES(?,?,?,?,?,?,?) ON CONFLICT(node_id,minute) DO UPDATE SET rx=excluded.rx,tx=excluded.tx,cpu=excluded.cpu,mem=excluded.mem,count=excluded.count').run(id,live.minute,a.rx,a.tx,a.cpu,a.mem,a.count);
  };
  const snapshot = () => {
    const today = dayKey(new Date(), settings.timezone),rates=fx.read();
    return getNodes().map(n => {
      const live = latest.get(n.id), seen = live?.received ?? n.last_seen;
      const status = !n.enabled ? 'disabled' : !seen ? 'pending' : now()-seen > settings.offline_seconds ? 'offline' : 'online';
      const { token_hash,ssh_password,agent_secret,country_ip, ...safe } = n;
      safe.ssh_configured=Boolean(ssh_password);
      safe.ssh_job=ssh.recent(n.id);
      safe.expiry=expiryView(n,today);
      return { ...safe,system:live?.metrics?.system||db.prepare('SELECT value FROM settings WHERE key=?').get('node_system:'+n.id)?.value||'',country_code:safe.country_override||safe.country_code, last_version:live?.metrics?.version??n.last_version, last_seen: seen, status, metrics: status === 'online' ? live?.metrics ?? null : null, traffic: dailyTotals(db,n,today), cost:nodeCost(n,rates), expired: Boolean(n.expires && n.expires < today),maintenance:n.maintenance_until>now() };
    });
  };
  const publicHistoryCache=new Map();
  function publicHistory(id='network',admin=false){
    if(!admin&&(!settings.public_enabled||!settings.public_show_metrics))fail(404,'公开网速记录尚未启用');
    const node=id==='network'?null:db.prepare('SELECT id,name,public_visible,public_show_name,country_override,country_code FROM nodes WHERE id=?').get(id);
    if(id!=='network'&&(!node||(!admin&&!node.public_visible)))fail(404,'公开服务器不存在');
    const visibleNodes=getNodes().filter(n=>(admin||n.public_visible)&&(node?n.id===id:n.enabled)),signature=JSON.stringify(visibleNodes.map(n=>[n.id,n.name,n.enabled,n.public_show_name,n.country_override,n.country_code]));
    const cacheKey=(admin?'admin:':'')+id,stamp=now(),cached=publicHistoryCache.get(cacheKey);if(cached&&stamp-cached.stamp<15&&cached.signature===signature)return cached.data;
    const start=stamp-86400,filter=node?'n.id=?'+(admin?'':' AND n.public_visible=1'):(admin?'n.enabled=1':'n.public_visible=1 AND n.enabled=1'),params=node?[start,stamp,id]:[start,stamp];
    const rows=db.prepare('SELECT m.minute,SUM(m.rx/m.count) rx,SUM(m.tx/m.count) tx FROM minutes m JOIN nodes n ON n.id=m.node_id WHERE m.minute>=? AND m.minute<=? AND '+filter+' GROUP BY m.minute ORDER BY m.minute').all(...params);
    const byMinute=new Map(rows.map(row=>[row.minute,{...row}]));
    const visible=new Set(visibleNodes.map(n=>n.id));
    for(const [nodeId,live] of latest){if(!visible.has(nodeId)||live.minute<start||live.minute>stamp)continue;const stored=db.prepare('SELECT rx/count rx,tx/count tx FROM minutes WHERE node_id=? AND minute=?').get(nodeId,live.minute),a=live.aggregate,row=byMinute.get(live.minute)||{minute:live.minute,rx:0,tx:0};row.rx+=a.rx/a.count-(stored?.rx||0);row.tx+=a.tx/a.count-(stored?.tx||0);byMinute.set(live.minute,row);}
    const data={brand:brandView(settings),public_path:settings.public_path,id:node?.id??'network',name:node?(admin?node.name:publicNodeName(node)):'当前总网速',hours:24,start,server_time:stamp,minutes:[...byMinute.values()].sort((a,b)=>a.minute-b.minute).map(r=>({minute:r.minute,rx:Math.max(0,r.rx),tx:Math.max(0,r.tx)}))};data.timezone=settings.timezone;data.chart_svg=networkChart(data);data.peak=Math.max(0,...data.minutes.map(r=>r.rx+r.tx));data.average=data.minutes.length?data.minutes.reduce((sum,r)=>sum+r.rx+r.tx,0)/data.minutes.length:0;publicHistoryCache.set(cacheKey,{stamp,data,signature});if(publicHistoryCache.size>201)publicHistoryCache.delete(publicHistoryCache.keys().next().value);return data;
  }
  function publicChart(id){const {minutes,...chart}=publicHistory(id);return chart;}
  async function telegram(message) {
    const result = await fetch(`https://api.telegram.org/bot${settings.telegram_token}/sendMessage`, {
      method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ chat_id:settings.telegram_chat, text:message }), signal:AbortSignal.timeout(10000)
    });
    const body = await result.json();
    if (!result.ok || !body.ok) throw new Error(`Telegram ${result.status}: ${String(body.description ?? '发送失败').slice(0,180)}`);
  }
  async function notifications() {
    if (workerBusy || closed || restoring || now()<notificationGraceUntil) return;
    workerBusy = true;
    try {
      const stamp = now(), today = dayKey(new Date(),settings.timezone);let nodes = snapshot();if(renewOnlineNodes(db,nodes,settings.timezone,stamp).length){publicCache=null;nodes=snapshot();}
      forwardAlerts.observe(nodes,forwarding.list(),settings,enqueue,stamp);
      for (const n of nodes) {
        if(!n.enabled)continue;
        processAlarms(db,n,settings,stamp,today,enqueue);
        if (!n.last_seen||!n.alerts_enabled||n.maintenance_until>stamp||inQuiet(settings)) continue;
        if(!notificationSelected(settings,'offline',n.id))noticeState.delete(n.id);
        const previous = noticeState.get(n.id);
        const historyFresh = n.history_seen && stamp-n.history_seen < 900 && !n.history_error && n.history_timezone === settings.timezone;
        if (n.status === 'offline') {
          if (notificationSelected(settings,'offline',n.id) && enqueue(`offline:${n.id}:${n.last_seen}`, `🔴 ${settings.brand_name} · ${n.name} 离线\n最后上报：${new Date(n.last_seen*1000).toISOString()}`)) noticeState.set(n.id,'offline');
        } else {
          if (previous === 'offline' && notificationSelected(settings,'offline',n.id) && enqueue(`recovery:${n.id}:${n.last_seen}`, `🟢 ${settings.brand_name} · ${n.name} 恢复在线`)) noticeState.set(n.id,'online');
          if (notificationSelected(settings,'quota',n.id) && historyFresh && n.traffic.ratio !== null) for (const threshold of settings.thresholds) if (n.traffic.ratio >= threshold) enqueue(`quota:${n.id}:${n.traffic.bounds.start}:${n.quota}:${n.billing_mode}:${threshold}`, `⚠️ ${settings.brand_name} · ${n.name} 流量达到 ${threshold}%\n已用 ${formatBytes(n.traffic.measured)} / ${formatBytes(n.quota)}\n周期 ${n.traffic.bounds.start} 至 ${n.traffic.bounds.end}（结束日不含）`);
        }
      }
      const clock = Object.fromEntries(new Intl.DateTimeFormat('en-GB',{timeZone:settings.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date()).map(x=>[x.type,x.value]));
      if (settings.report_enabled && Number(clock.hour)*60+Number(clock.minute) >= settings.report_hour*60+settings.report_minute) {
        const yesterday = new Date(Date.parse(today)-86400000).toISOString().slice(0,10);
        const lines = dailyReportLines(nodes.filter(n=>n.enabled&&notificationSelected(settings,'report',n.id)),stamp);
        let message = `📊 ${settings.brand_name} 日报 · ${yesterday}\n统计时区：${settings.timezone}`, part = 0;
        for (const line of lines) { if (message.length+line.length>3000) { enqueue(`daily:${today}:${part++}`,message); message='📊 日报（续）'; } message+='\n\n'+line; }
        if(lines.length)enqueue(`daily:${today}:${part}`,message);
      }
      if (settings.telegram_token && settings.telegram_chat && !options.disableTelegram) {
        const job = db.prepare("SELECT * FROM outbox WHERE status='pending' AND next_try<=? ORDER BY id LIMIT 1").get(stamp);
        if (job) {
          try { await telegram(job.message); db.prepare("UPDATE outbox SET status='sent',sent=?,error='' WHERE id=?").run(now(),job.id); }
          catch (e) { const attempts=job.attempts+1; db.prepare('UPDATE outbox SET attempts=?,next_try=?,error=?,status=? WHERE id=?').run(attempts,now()+Math.min(3600,30*2**Math.min(attempts,7)),String(e.message).replaceAll(settings.telegram_token,'[redacted]'),attempts>=12?'failed':'pending',job.id); }
        }
      }
    } finally { workerBusy=false; }
  }
  function ingest(node, data) {
    const stamp = now();
    const metrics = {};
    for (const [k,max] of [['rx_speed',1e13],['tx_speed',1e13],['cpu',100],['mem_total',8e15],['mem_used',8e15],['disk_total',8e15],['disk_used',8e15],['uptime',1e12]]) metrics[k]=finite(data[k],0,max,k);
    if (metrics.mem_used>metrics.mem_total || metrics.disk_used>metrics.disk_total) fail(400,'容量数据无效');
    metrics.interface = textValue(data.interface,40,'网卡');
    if (!/^[a-zA-Z0-9_.:@-]+$/.test(metrics.interface) || (node.interface && node.interface!==metrics.interface)) fail(409,'统计网卡与后台配置不一致，请等待配置同步');
    metrics.hostname = textValue(data.hostname ?? '',120,'主机名');
    metrics.system = textValue(data.system ?? '',120,'操作系统');
    metrics.version = textValue(data.version ?? '',32,'版本');
    metrics.sample_error = textValue(data.sample_error ?? '',300,'采集错误');
    metrics.interfaces = Array.isArray(data.interfaces) ? data.interfaces.slice(0,64).filter(x=>typeof x==='string'&&/^[a-zA-Z0-9_.:@-]{1,40}$/.test(x)) : [];
    const previous=latest.get(node.id);
    if (previous && stamp-previous.received < 2) fail(429,'上报过于频繁');
    let days=[];
    const historyIncluded = Object.hasOwn(data,'days');
    let historyError='';
    if (historyIncluded) {
      if (!Array.isArray(data.days) || data.days.length>730) fail(400,'历史数据格式无效');
      const today=dayKey(new Date(),settings.timezone);
      days=data.days.map(d=>{ if(!validDate(d.date)||d.date>today) fail(400,'流量日期无效'); return {date:d.date,rx:finite(d.rx,0,8e15,'rx',true),tx:finite(d.tx,0,8e15,'tx',true)}; });
      historyError=textValue(data.history_error ?? '',300,'流量错误');
      if (data.history_timezone!==settings.timezone) historyError='节点 vnStat 时区与主控不一致，未接收日流量';
    }
    const minute=Math.floor(stamp/60)*60;
    db.exec('BEGIN');
    try {
      if (!previous || previous.minute!==minute) db.prepare('UPDATE nodes SET last_seen=?,last_version=? WHERE id=?').run(stamp,metrics.version,node.id);
      if(previous && previous.minute!==minute) flushMinute(node.id,previous);
      if(!node.interface) db.prepare('UPDATE nodes SET interface=? WHERE id=?').run(metrics.interface,node.id);
      if (historyIncluded) {
        db.prepare('UPDATE nodes SET history_seen=?,history_error=?,history_timezone=? WHERE id=?').run(stamp,historyError,String(data.history_timezone ?? '').slice(0,80),node.id);
        if (!historyError) {
          const insert=db.prepare('INSERT INTO daily VALUES(?,?,?,?,?) ON CONFLICT(node_id,interface,date) DO UPDATE SET rx=MAX(rx,excluded.rx),tx=MAX(tx,excluded.tx)');
          const existing=db.prepare('SELECT rx,tx FROM daily WHERE node_id=? AND interface=? AND date=?');
          let regression=false;
          for (const d of days) {
            const old=existing.get(node.id,metrics.interface,d.date);
            if(old&&(d.rx<old.rx||d.tx<old.tx)) regression=true;
            insert.run(node.id,metrics.interface,d.date,d.rx,d.tx);
          }
          if(regression) db.prepare('UPDATE nodes SET history_error=? WHERE id=?').run('vnStat 日流量低于已保存值，已保留原值；请检查节点数据库是否重置',node.id);
        }
      }
      forwarding.ingest(node.id,data.forwarding);
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
    const a=previous?.minute===minute?previous.aggregate:{rx:0,tx:0,cpu:0,mem:0,count:0};
    a.rx+=metrics.rx_speed;a.tx+=metrics.tx_speed;a.cpu+=metrics.cpu;a.mem+=metrics.mem_total?metrics.mem_used/metrics.mem_total*100:0;a.count++;
    if(metrics.system){const key='node_system:'+node.id;const stored=db.prepare('SELECT value FROM settings WHERE key=?').get(key);if(stored?.value!==metrics.system)db.prepare('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key,metrics.system);}
    latest.set(node.id,{received:stamp,minute,metrics,aggregate:a});
  }
  async function body(req) {
    const epoch=restoreEpoch,authEpoch=account.generation;let bytes=0; const chunks=[];
    for await (const chunk of req) { bytes+=chunk.length; if(bytes>256*1024) fail(413,'请求过大'); chunks.push(chunk); }
    if(restoring)fail(503,'正在恢复备份，请稍后重试');
    if(authEpoch!==account.generation)fail(401,'账号已更新，请重新登录');
    if(epoch!==restoreEpoch)fail(409,'数据已恢复，请重试请求');
    try { const data=JSON.parse(Buffer.concat(chunks).toString()); if(!data||Array.isArray(data)||typeof data!=='object') fail(400,'需要 JSON 对象'); return data; } catch(e) { if(e.status) throw e; fail(400,'JSON 格式无效'); }
  }
  function auth(req, mutate=false) {
    const cookie=/(?:^|;\s*)lp_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1];
    const s=sessions.get(cookie);
    if(!s||s.expires<now()) { if(cookie) sessions.delete(cookie); fail(401,'请登录'); }
    if(mutate && req.headers['x-csrf-token']!==s.csrf) fail(403,'请求验证失败，请重新登录');
    return { ...s,cookie };
  }
  const writeNode=(id,n)=>{publicCache=null;return db.prepare(`UPDATE nodes SET ${Object.keys(n).map(k=>k+'=?').join(',')} WHERE id=?`).run(...Object.values(n),id);};
  async function restoreBackup(req) {
    if(backups.busy||remoteBackup.busy||restoring||(agentBatch.busy||forwardBatch.busy||getNodes().some(n=>ssh.busy(n.id))))fail(409,'已有备份、恢复或 SSH 部署正在进行');
    const epoch=restoreEpoch,incoming=dbPath+'.incoming-'+randomUUID();let ownsLock=false;
    try {
      const passwordHeader=String(req.headers['x-backup-password']||'');if(passwordHeader.length>2048||passwordHeader&&!/^[A-Za-z0-9+/]*={0,2}$/.test(passwordHeader))fail(400,'备份密码编码无效');
      const archive=await receiveRestore(req,incoming,Buffer.from(passwordHeader,'base64').toString('utf8'));
      // Validate and migrate the candidate before touching the running database.
      const candidate=openStore(incoming);
      try {
        const saved=JSON.parse(candidate.prepare("SELECT value FROM settings WHERE key='config'").get()?.value??'{}');
        settingsFields({...initial,...saved},{...initial,...saved});
        const nodes=candidate.prepare('SELECT * FROM nodes').all();if(nodes.length>200)fail(400,'备份节点超过 200 台');for(const n of nodes){nodeFields(n);sshFields(n);if(typeof n.ssh_fingerprint!=="string"||n.ssh_fingerprint&& !/^SHA256:[A-Za-z0-9+/]{43}$/.test(n.ssh_fingerprint))fail(400,"备份 SSH 指纹无效");}
        const pluginRows=candidate.prepare("SELECT key,value FROM settings WHERE key LIKE 'plugin:%'").all();if(pluginRows.length>30)fail(400,'备份插件超过 30 个');for(const row of pluginRows){const pack=validatePluginPackage(JSON.parse(row.value));if(row.key!=='plugin:'+pack.manifest.id)fail(400,'备份插件 ID 不一致');}
        if(archive){const sourceVault=vaultFromKey(Buffer.from(archive.ssh_key,'base64'));for(const node of nodes)for(const field of ['ssh_password','agent_secret'])if(node[field])candidate.prepare('UPDATE nodes SET '+field+'=? WHERE id=?').run(vault.seal(sourceVault.open(node[field],node.id),node.id),node.id);
          const telegramSecret=candidate.prepare("SELECT value FROM settings WHERE key='telegram_secret'").get();if(telegramSecret)candidate.prepare("UPDATE settings SET value=? WHERE key='telegram_secret'").run(vault.seal(sourceVault.open(telegramSecret.value,'telegram-token'),'telegram-token'));
          const cloud=candidate.prepare("SELECT value FROM settings WHERE key='rclone_config'").get();if(cloud){const text=sourceVault.open(cloud.value,'rclone-config');parseDriveConfig(text);candidate.prepare("UPDATE settings SET value=? WHERE key='rclone_config'").run(vault.seal(text,'rclone-config'));}
          const remote=candidate.prepare("SELECT value FROM settings WHERE key='remote_backup'").get();if(remote){const c=remoteFields({},JSON.parse(remote.value));if(c.pass_cipher)c.pass_cipher=vault.seal(sourceVault.open(c.pass_cipher,'remote-backup'),'remote-backup');candidate.prepare("UPDATE settings SET value=? WHERE key='remote_backup'").run(JSON.stringify(c));}}
      loadTelegramSettings(candidate,vault,{...initial,...saved});
      }finally{candidate.close();}
      if(restoring||backups.busy||remoteBackup.busy||epoch!==restoreEpoch||(agentBatch.busy||forwardBatch.busy||getNodes().some(n=>ssh.busy(n.id))))fail(409,'已有恢复或部署操作，请稍后重试');
      restoring=true;
      ownsLock=true;
      while(workerBusy||fx.busy)await new Promise(r=>setTimeout(r,20));
      for(const [id,l] of latest){flushMinute(id,l);db.prepare('UPDATE nodes SET last_seen=? WHERE id=?').run(l.received,id);}
      await backups.create('before-restore');
      const currentAccount=db.prepare("SELECT value FROM settings WHERE key='admin_auth'").get().value;
      // Keep the live connection open and restore all tables in one transaction.
      // This also works on Windows where prepared statements may retain file handles.
      db.prepare('ATTACH DATABASE ? AS restored').run(incoming);
      try{
        db.exec('BEGIN IMMEDIATE');
        try{
          for(const table of ['alerts','daily','minutes','outbox','settings','nodes'])db.exec(`DELETE FROM main.${table}`);
          for(const table of ['nodes','daily','minutes','settings','outbox','alerts']){
            const columns=db.prepare(`PRAGMA main.table_info(${table})`).all().map(x=>x.name).join(',');
            db.exec(`INSERT INTO main.${table}(${columns}) SELECT ${columns} FROM restored.${table}`);
          }
          db.prepare("UPDATE outbox SET event_key=event_key||?,status='failed',error='恢复后已取消旧待发送通知' WHERE status='pending'").run(':restored-'+randomUUID());
          db.prepare("INSERT INTO settings VALUES('admin_auth',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(currentAccount);
          db.exec('DELETE FROM alerts');
          db.exec("UPDATE sqlite_sequence SET seq=(SELECT COALESCE(MAX(id),0) FROM outbox) WHERE name='outbox'; COMMIT;");
        }catch(e){db.exec('ROLLBACK');throw e;}
      }finally{db.exec('DETACH DATABASE restored');}
      settings={...initial,...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='config'").get()?.value??'{}')};
      loadTelegramSettings(db,vault,settings);pluginAccess.reset();
      notificationGraceUntil=now()+settings.offline_seconds;
      restoreEpoch++;geoAttempts.clear();geoPending.clear();agentBatch.cancel();agentBatch.reset();forwardBatch.cancel();forwardBatch.reset();ssh.reset();publicHistoryCache.clear();
      publicCache=null;
      sessions.clear();latest.clear();noticeState.clear();
    }finally{if(ownsLock)restoring=false;const cleanup=attempt=>{try{for(const suffix of ['','-wal','-shm'])rmSync(incoming+suffix,{force:true});}catch(e){if(attempt<12&&['EPERM','EBUSY','EACCES'].includes(e.code))setTimeout(()=>cleanup(attempt+1),5000).unref();else console.error('Restore cleanup:',e.name);}};cleanup(0);}
  }
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store'); res.setHeader('X-Content-Type-Options','nosniff'); res.setHeader('X-Frame-Options','DENY');
    res.setHeader('Referrer-Policy','no-referrer'); res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url=new URL(req.url,'http://localhost'), path=url.pathname, method=req.method;
      if(restoring)fail(503,'正在恢复备份，请稍后重试');
      if(method==='GET'&&path==='/healthz') return send(res,200,{ok:true});
      if(method==='GET'&&path==='/api/brand') return send(res,200,brandView(settings));
      if(method==='GET'&&path==='/api/public/history')return send(res,200,publicChart());
      const publicNodeHistory=/^\/api\/public\/nodes\/([a-f0-9-]{36})\/history$/.exec(path);if(method==='GET'&&publicNodeHistory)return send(res,200,publicChart(publicNodeHistory[1]));
      if(method==='GET'&&path==='/api/public') {
        if(!settings.public_enabled)fail(404,'公开展示尚未启用');
        if(!publicCache||now()-publicCache.created>=5){const nodes=snapshot().filter(n=>n.public_visible).map(n=>({id:n.id,name:publicNodeName(n),system:settings.public_show_system?n.system:undefined,group_name:n.group_name,status:n.status,last_seen:n.last_seen,country_code:/^[A-Z]{2}$/.test(n.country_code)?n.country_code:'',metrics:settings.public_show_metrics&&n.metrics?{rx_speed:n.metrics.rx_speed,tx_speed:n.metrics.tx_speed,cpu:n.metrics.cpu,uptime:n.metrics.uptime,mem_percent:n.metrics.mem_total?n.metrics.mem_used/n.metrics.mem_total*100:0,disk_percent:n.metrics.disk_total?n.metrics.disk_used/n.metrics.disk_total*100:0}:undefined,traffic:settings.public_show_traffic?{today:n.traffic.today.rx+n.traffic.today.tx,month:n.traffic.month.rx+n.traffic.month.tx}:undefined}));publicCache={created:now(),payload:{brand:brandView(settings),public_path:settings.public_path,nodes,network:settings.public_show_metrics?nodes.filter(n=>n.status!=='disabled').reduce((total,n)=>({rx:total.rx+(n.metrics?.rx_speed||0),tx:total.tx+(n.metrics?.tx_speed||0)}),{rx:0,tx:0}):undefined,show_network:settings.public_show_metrics,server_time:now()}};}
        return send(res,200,publicCache.payload);
      }
      // Only these public program files are downloadable; configuration and tokens are never served here.
      if(method==='GET' && downloads.has(path)) {
        const file=downloads.get(path);
        let size; try {size=statSync(file).size;} catch {fail(503,'安装文件缺失，请重新构建主控镜像');}
        res.setHeader('Content-Type',path.endsWith('.sh')?'text/plain; charset=utf-8':'application/octet-stream');
        res.setHeader('Content-Length',size);
        await pipeline(createReadStream(file),res); return;
      }
      if(path.startsWith('/api/agent/')) {
        const raw=/^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '')?.[1];
        const node=raw?db.prepare('SELECT * FROM nodes WHERE token_hash=? AND enabled=1').get(sha(raw)):null;
        if(!node) fail(401,'上报密钥无效或节点已停用');
        if(method==='GET'&&path==='/api/agent/config') return send(res,200,{interface:node.interface,interval:settings.interval,timezone:settings.timezone,history_days:settings.keep_days});
        if(method==='POST'&&path==='/api/agent/report') { ingest(node,await body(req)); countryQueue(node.id,reportIP(req,node)); return send(res,200,{ok:true}); }
        fail(404,'接口不存在');
      }
      if(method==='POST'&&path===settings.admin_path+'/api/login') {
        if(req.headers.origin && appOrigin && req.headers.origin!==appOrigin) fail(403,'来源无效');
        const ip=await clientIP(req);if(loggingIn>=3)fail(429,'登录请求繁忙，请稍后重试');
        const data=await body(req);if(typeof data.password!=='string'||data.password.length>256||typeof data.username!=='string'||data.username.length>64)fail(400,'账号或密码无效');
        const delay=loginLimiter.attempt(ip,data.username);
        loggingIn++;let valid;try{if(delay)await new Promise(r=>setTimeout(r,delay));valid=await account.verify(data.password);}finally{loggingIn--;}
        valid=valid&&data.username===account.username;loginLimiter.result(data.username,valid);
        if(!valid)fail(401,'用户名或密码错误');
        const id=token(),csrf=token(); if(sessions.size>=500) sessions.delete(sessions.keys().next().value);
        sessions.set(id,{csrf,expires:now()+43200});
        res.setHeader('Set-Cookie',`lp_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`);
        return send(res,200,{csrf,username:account.username});
      }
      if(method==='POST'&&path.endsWith('/api/login'))fail(404,'接口不存在');
      if(path.startsWith('/api/')) {
        const session=auth(req,method!=='GET');
        if(path==='/api/agents/batch-update'&&method==='GET')return send(res,200,agentBatch.view());
        if(path==='/api/agents/batch-update'&&method==='POST'){if(forwardBatch.busy)fail(409,'转发安装 / 更新队列正在执行，请稍后重试');return send(res,202,agentBatch.start());}
        if(path==='/api/forwarding/batch'&&method==='GET')return send(res,200,forwardBatch.view());
        if(path==='/api/forwarding/batch'&&method==='POST'){if(agentBatch.busy)fail(409,'采集端更新队列正在执行，请稍后重试');const data=await body(req);if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'请求格式无效');return send(res,202,forwardBatch.start(data.node_id??'',data.group_id?forwardGroups.scope(data.group_id):null));}
        if(path==='/api/forwarding/alerts'&&method==='GET')return send(res,200,forwardAlerts.config());
        if(path==='/api/forwarding/alerts'&&method==='PUT')return send(res,200,forwardAlerts.save(await body(req)));
        if(path.startsWith('/api/forwarding')&&['POST','PUT','DELETE'].includes(method)&&forwardBatch.busy)fail(409,'转发安装 / 更新队列正在执行，请完成后再修改规则');
        if(path==='/api/forwarding/traffic'&&method==='GET')return send(res,200,forwardServerHistory(db,settings.timezone,new URL(req.url,'http://localhost').searchParams));
        if(path==='/api/forwarding/groups'&&method==='GET')return send(res,200,forwardGroups.list());
        if(path==='/api/forwarding/groups'&&method==='POST')return send(res,201,forwardGroups.write(await body(req)));
        const forwardGroupMatch=/^\/api\/forwarding\/groups\/([a-f0-9-]{36})$/.exec(path);
        if(forwardGroupMatch&&method==='PUT')return send(res,200,forwardGroups.write(await body(req),forwardGroupMatch[1]));
        if(forwardGroupMatch&&method==='DELETE')return send(res,200,forwardGroups.remove(forwardGroupMatch[1]));
        if(path==='/api/forwarding/diagnose'&&method==='POST'){const input=await body(req),n=getNodes().find(n=>n.id===input?.node_id);if(!n)fail(404,'服务器不存在');const rules=forwarding.list().filter(r=>r.node_id===n.id);if(!rules.length)fail(400,'该服务器没有转发规则');return send(res,202,ssh.runManaged(n.id,forwardDiagnosticScript(n.interface,rules.map(r=>r.id))));}
        if(path==='/api/forwarding/copy'&&method==='POST')return send(res,201,forwarding.copy(await body(req)));
        const forwardingHistory=/^\/api\/forwarding\/([a-f0-9-]{36})\/history$/.exec(path);if(forwardingHistory&&method==='GET'){const month=new URL(req.url,'http://localhost').searchParams.get('month');return send(res,200,{...(month?forwarding.dailyHistory(forwardingHistory[1],month):{months:forwarding.history(forwardingHistory[1])}),timezone:settings.timezone});}
        if(path==='/api/forwarding/order'&&method==='POST'){const data=await body(req);return send(res,200,forwarding.reorder(data.node_id,data.ids));}
        if(path==='/api/forwarding'&&method==='GET'){const rules=forwarding.list(),all=snapshot(),involved=new Set(rules.map(r=>r.node_id)),included=all.filter(n=>n.enabled&&involved.has(n.id)),today=included.reduce((t,n)=>({rx:t.rx+n.traffic.today.rx,tx:t.tx+n.traffic.today.tx}),{rx:0,tx:0});return send(res,200,{rules:rules.map(r=>({...r,urls:forwardURLs(r)})),nodes:all.map(n=>({id:n.id,name:n.name,enabled:n.enabled,status:n.status,country_code:n.country_code,today:n.traffic.today,history_seen:n.history_seen,history_error:n.history_error,history_timezone:n.history_timezone,gost_today:forwarding.summary(undefined,n.id).today})),groups:forwardGroups.list(),interface_summary:{timezone:settings.timezone,server_count:included.length,today:{...today,total:today.rx+today.tx},stale_count:included.filter(n=>!n.history_seen||now()-n.history_seen>900||n.history_error||n.history_timezone!==settings.timezone).length},events:forwardAlerts.history(),batch:forwardBatch.view(),gost_version:gostVersion,summary:forwarding.summary()});}
        if(path==='/api/forwarding'&&method==='POST')return send(res,201,forwarding.add(await body(req)));
        const forwardingEdit=/^\/api\/forwarding\/([a-f0-9-]{36})$/.exec(path);if(forwardingEdit&&method==='PUT')return send(res,202,forwarding.update(forwardingEdit[1],await body(req)));
        const forwardingAction=/^\/api\/forwarding\/([a-f0-9-]{36})\/(start|resume|stop|status|remove)$/.exec(path);
        if(forwardingAction&&method==='POST')return send(res,202,forwarding.action(forwardingAction[1],forwardingAction[2]));
        if(path==='/api/traffic/history'&&method==='GET')return send(res,200,trafficHistory(db,settings,new URL(req.url,'http://localhost').searchParams));
        if(path==='/api/ssh/draft/probe'&&method==='POST')return send(res,200,await ssh.draftProbe(await body(req),session.cookie));
        if(path==='/api/ssh/draft/test'&&method==='POST')return send(res,200,await ssh.draftTest(await body(req),session.cookie));
        if(path==='/api/plugins/upload'&&method==='POST'){const input=await body(req);return send(res,201,plugins.install(input.package,input.replace===true));}
        const removePlugin=/^\/api\/plugins\/([a-z][a-z0-9-]{0,39})$/.exec(path);if(removePlugin&&method==='DELETE'){plugins.remove(removePlugin[1]);return send(res,200,{ok:true});}
        if(path==='/api/remote-backup'&&method==='GET')return send(res,200,remoteBackup.view());
        if(path==='/api/remote-backup'&&method==='PUT')return send(res,200,remoteBackup.save(await body(req)));
        if(path==='/api/remote-backup/token'&&method==='POST'){const input=await body(req);if(typeof input.token!=='string'||input.token.length>16000)fail(400,'授权结果格式无效');let token;try{token=JSON.parse(input.token);}catch{fail(400,'请粘贴完整 JSON 授权结果');}if(!token||Array.isArray(token)||typeof token.access_token!=='string'||typeof token.refresh_token!=='string')fail(400,'授权结果缺少访问或刷新 Token');const config='[gdrive]\ntype = drive\nscope = drive.file\ntoken = '+JSON.stringify(token)+'\n';return send(res,200,remoteBackup.importConfig(config));}
        if(path==='/api/remote-backup/config'&&method==='POST')return send(res,200,remoteBackup.importConfig((await body(req)).config));
        if(path==='/api/remote-backup/run'&&method==='POST')return send(res,202,remoteBackup.start());
        if(path==='/api/plugins'&&method==='GET')return send(res,200,plugins.list().map(p=>({...p,access:pluginAccess.view(p.id),scope_labels:pluginScopes})));
        const pluginPermission=/^\/api\/plugins\/([a-z][a-z0-9-]{0,39})\/permissions$/.exec(path);
        if(pluginPermission&&method==='PUT'){const input=await body(req);const access=pluginAccess.grant(pluginPermission[1],input.permissions);return send(res,200,access);}
        const pluginFrameRoute=/^\/api\/plugins\/([a-z][a-z0-9-]{0,39})\/frame$/.exec(path);
        if(pluginFrameRoute&&method==='GET'){const source=plugins.source(pluginFrameRoute[1]);if(source===undefined)fail(404,'插件不存在');const frame=pluginFrame(source);res.removeHeader('X-Frame-Options');res.setHeader('Content-Security-Policy',frame.csp);res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(frame.html);}
        const pluginBridge=/^\/api\/plugins\/([a-z][a-z0-9-]{0,39})\/(approve|invoke)$/.exec(path);
        if(pluginBridge&&method==='POST'){
          const input=await body(req),id=pluginBridge[1];
          if(pluginBridge[2]==='approve')return send(res,200,pluginAccess.approve(id,input,session.cookie));
          const op=pluginAccess.invoke(id,input,session.cookie),rateKey=session.cookie+':'+id;let rate=pluginCalls.get(rateKey);if(!rate||rate.until<now()){if(pluginCalls.size>=500)pluginCalls.delete(pluginCalls.keys().next().value);rate={count:0,until:now()+60};pluginCalls.set(rateKey,rate);}if(++rate.count>60)fail(429,'插件请求过于频繁，请稍后再试');
          if(op.path==='/api/nodes'&&op.method==='GET')return send(res,200,{nodes:pluginNodes(snapshot()),settings:{timezone:settings.timezone,interval:settings.interval}});
          if(op.path==='/api/notifications/send'){if(!enqueue('plugin:'+id+':'+randomUUID(),'🔌 '+plugins.list().find(p=>p.id===id).name+'\n'+op.data.message))fail(400,'请先配置 Telegram 通知');return send(res,200,{ok:true,message:'通知已加入发送队列'});}
          const port=server.address()?.port;if(!port)fail(503,'主控尚未启动');
          const response=await fetch('http://127.0.0.1:'+port+op.path,{method:op.method,headers:{'Content-Type':'application/json',Cookie:req.headers.cookie||'','X-CSRF-Token':session.csrf},body:op.method==='GET'?undefined:JSON.stringify(op.data??{}),signal:AbortSignal.timeout(op.scope==='ssh.deploy'?60000:20000),redirect:'error'});
          let result=await response.json();if(op.path==='/api/nodes'&&op.method==='POST'&&response.ok)result={id:result.id,message:'服务器已添加；采集端密钥请在后台管理'};return send(res,response.status,result);
        }

        const pluginRoute=/^\/api\/plugins\/([a-z][a-z0-9-]{0,39})\/module$/.exec(path);if(pluginRoute&&method==='GET'){const source=plugins.source(pluginRoute[1]);if(source===undefined)fail(404,'插件不存在');res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-store'});return res.end(source);}
        if(path==='/api/account'&&method==='POST'){const result=await account.change(await body(req));sessions.clear();res.setHeader('Set-Cookie','lp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{...result,redirect_admin:settings.admin_path,message:'账号已更新，请重新登录'});}
        if(path==='/api/session'&&method==='GET') return send(res,200,{csrf:session.csrf,username:account.username});
        if(path==='/api/logout'&&method==='POST') {sessions.delete(session.cookie);res.setHeader('Set-Cookie','lp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
        const sshRoute=/^\/api\/nodes\/([a-f0-9-]{36})\/ssh\/(probe|trust|test|deploy)$/.exec(path);
        if(sshRoute&&method==='POST'){const [unused,id,action]=sshRoute;if(action==='probe')return send(res,200,await ssh.probe(id));if(action==='trust'){const input=await body(req);ssh.trust(id,input.fingerprint);return send(res,200,{ok:true});}if(action==='test')return send(res,200,await ssh.test(id));return send(res,202,ssh.deploy(id));}
        const jobRoute=/^\/api\/ssh\/jobs\/([a-f0-9-]{36})$/.exec(path);if(jobRoute&&method==='GET')return send(res,200,ssh.status(jobRoute[1]));
        if(path==='/api/nodes'&&method==='GET') {const rates=fx.read();const {rates:unused,...fxInfo}=rates;return send(res,200,{nodes:snapshot(),settings:safeSettings(),cost_summary:costSummary(getNodes(),rates),fx_info:fxInfo,server_time:now(),version:'0.2.32',agent_version:'0.2.2'});}
        const adminNetwork=/^\/api\/nodes\/([a-f0-9-]{36})\/network-history$/.exec(path);if(adminNetwork&&method==='GET')return send(res,200,publicHistory(adminNetwork[1],true));
        if(path==='/api/network/history'&&method==='GET')return send(res,200,publicHistory('network',true));
        if(path==='/api/costs'&&method==='GET')return send(res,200,{...costSummary(getNodes(),fx.read()),fx:fx.read()});
        if(path==='/api/fx/refresh'&&method==='POST')return send(res,200,await fx.refresh(true));
        if(path==='/api/backups'&&method==='GET')return send(res,200,backups.list());
        if(path==='/api/backups'&&method==='POST'){for(const [id,l] of latest){flushMinute(id,l);db.prepare('UPDATE nodes SET last_seen=?,last_version=? WHERE id=?').run(l.received,l.metrics.version,id);}return send(res,201,await backups.create());}
        const download=/^\/api\/backups\/([^/]+)$/.exec(path);
        if(download&&method==='DELETE'){backups.remove(download[1]);return send(res,200,{ok:true});}
        if(download&&method==='GET'){if(!backupName.test(download[1])||!backups.list().some(x=>x.name===download[1]))fail(404,'备份不存在');const file=join(backups.directory,download[1]);res.setHeader('Content-Type','application/vnd.sqlite3');res.setHeader('Content-Disposition',`attachment; filename="${download[1]}"`);res.setHeader('Content-Length',statSync(file).size);await pipeline(createReadStream(file),res);return;}
        if(path==='/api/backups/restore'&&method==='POST'){await restoreBackup(req);fx.refresh().catch(()=>{});res.setHeader('Set-Cookie','lp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true,message:'备份已恢复，请重新登录',redirect_admin:settings.admin_path});}
        if(path==='/api/nodes/order'&&method==='PUT') {const input=await body(req),nodes=getNodes(),ids=input.ids;if(!Array.isArray(ids)||ids.length!==nodes.length||new Set(ids).size!==ids.length||ids.some(id=>!nodes.some(n=>n.id===id)))fail(409,'服务器列表已变化，请刷新后重试');db.exec('BEGIN');try{const update=db.prepare('UPDATE nodes SET sort=? WHERE id=?');ids.forEach((id,index)=>update.run(index,id));db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}publicCache=null;return send(res,200,{ok:true});}
        if(path==='/api/nodes'&&method==='POST') {
          if(getNodes().length>=200) fail(400,'首版最多支持 200 台机器');
          const input=await body(req),id=randomUUID(),secret=token(),n=configuredNode({...input,sort:input.sort??Math.min(9999,Math.max(-1,...getNodes().map(n=>n.sort))+1)},{},id);
          const fields={id,token_hash:sha(secret),agent_secret:vault.seal(secret,id),...n,created:now()};db.prepare(`INSERT INTO nodes(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields));
          publicCache=null;
          return send(res,201,{id,token:secret,public_url:publicURL});
        }
        const renewal=/^\/api\/nodes\/([a-f0-9-]{36})\/renew$/.exec(path);
        if(renewal&&method==='POST'){const input=await body(req),result=renewManually(db,renewal[1],input,dayKey(new Date(),settings.timezone),now());publicCache=null;return send(res,200,result);}
        const match=/^\/api\/nodes\/([a-f0-9-]{36})(?:\/(history|token))?$/.exec(path);
        if(match) {
          const node=db.prepare('SELECT * FROM nodes WHERE id=?').get(match[1]); if(!node) fail(404,'节点不存在');
          if(match[2]==='history'&&method==='GET') {
            const hours=Number(url.searchParams.get('hours')??24);if(![1,24,168].includes(hours))fail(400,'趋势范围无效');const cutoff=now()-hours*3600,bucket=hours===168?600:60;
            flushMinute(node.id,latest.get(node.id));
            return send(res,200,{hours,bucket,minutes:db.prepare('SELECT CAST(minute/? AS INTEGER)*? minute,SUM(rx)/SUM(count) rx,SUM(tx)/SUM(count) tx,SUM(cpu)/SUM(count) cpu,SUM(mem)/SUM(count) mem FROM minutes WHERE node_id=? AND minute>=? GROUP BY CAST(minute/? AS INTEGER) ORDER BY minute').all(bucket,bucket,node.id,cutoff,bucket),daily:db.prepare('SELECT date,SUM(rx) rx,SUM(tx) tx FROM daily WHERE node_id=? GROUP BY date ORDER BY date DESC LIMIT 180').all(node.id)});
          }
          if(match[2]==='token'&&method==='POST') {const secret=token();if(ssh.busy(node.id))fail(409,'部署中不能重新生成密钥');db.prepare('UPDATE nodes SET token_hash=?,agent_secret=? WHERE id=?').run(sha(secret),vault.seal(secret,node.id),node.id);return send(res,200,{id:node.id,token:secret,public_url:publicURL});}
          if(!match[2]&&method==='PUT') {
            if(ssh.busy(node.id))fail(409,'部署中不能修改服务器配置');const input=await body(req);if(ssh.busy(node.id))fail(409,'部署中不能修改服务器配置');const n=configuredNode(input,node);
            if(n.interface!==node.interface && db.prepare('SELECT 1 FROM daily WHERE node_id=? LIMIT 1').get(node.id)) fail(409,'已有流量历史后不能更换统计网卡；请新建节点，避免重复计费');
            writeNode(node.id,n);
            return send(res,200,{ok:true});
          }
          if(!match[2]&&method==='DELETE') {if(forwarding.hasNode(node.id))fail(409,'请先删除该服务器的转发规则，再删除服务器');if(ssh.busy(node.id))fail(409,'部署中不能删除服务器');db.prepare('DELETE FROM nodes WHERE id=?').run(node.id);db.prepare('DELETE FROM settings WHERE key=?').run('node_system:'+node.id);latest.delete(node.id);noticeState.delete(node.id);geoAttempts.delete(node.id);geoPending.delete(node.id);publicCache=null;return send(res,200,{ok:true});}
        }
        if(path==='/api/settings'&&method==='GET') return send(res,200,editableSettings());
        if(path==='/api/settings'&&method==='PUT') {const input=await body(req),updated=settingsFields(input,settings);if(input.notification_targets!==undefined){const reportChanged=JSON.stringify(settings.notification_targets?.report??null)!==JSON.stringify(updated.notification_targets.report);for(const job of db.prepare("SELECT id,event_key FROM outbox WHERE status='pending'").all()){const [kind,id]=job.event_key.split(':'),type=({quota:'quota',offline:'offline',recovery:'offline','forward-failure':'offline','forward-recovery':'offline',resource:'resource','resource-recovery':'resource',expiry:'expiry',expired:'expiry'})[kind];if((kind==='daily'&&reportChanged)||(type&&!notificationSelected(updated,type,id)))db.prepare("UPDATE outbox SET event_key=event_key||?,status='failed',error='通知服务器范围调整，已取消待发送通知' WHERE id=?").run(':scope-'+randomUUID(),job.id);}}persistTelegramSettings(db,vault,updated);const pathChanged=settings.admin_path!==updated.admin_path;settings=updated;publicCache=null;publicHistoryCache.clear();if(pathChanged){sessions.clear();res.setHeader('Set-Cookie','lp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');}return send(res,200,{...editableSettings(),redirect_admin:pathChanged?settings.admin_path:undefined});}
        if(path==='/api/notifications'&&method==='GET') return send(res,200,db.prepare('SELECT id,status,attempts,created,sent,error FROM outbox ORDER BY id DESC LIMIT 5').all());
        if(path==='/api/notifications/test'&&method==='POST') {if(!enqueue(`test:${randomUUID()}`,`✅ ${settings.brand_name} 通知测试成功`)) fail(400,'请先配置 Telegram Token 和 Chat ID');return send(res,200,{ok:true,message:'已加入发送队列，请稍后查看状态'});}
        fail(404,'接口不存在');
      }
      if(method==='GET') {
        const publicBase=settings.public_path==='/'?'':settings.public_path;
        const publicDetail=path===publicBase+'/network'||new RegExp('^'+publicBase+'/servers/[a-f0-9-]{36}$').test(path);
        if(path==='/'&&settings.public_path!=='/'||(path==='/public'&&settings.public_path!=='/public')){res.writeHead(302,{Location:settings.public_path});res.end();return;}
        if(path===settings.admin_path+'/'){res.writeHead(302,{Location:settings.admin_path});res.end();return;}
        const admin=path===settings.admin_path,file=admin?'index.html':path===settings.public_path||publicDetail?'public.html':path.slice(1);
        if((file==='index.html'&&!admin)||file==='public.html'&&path!==settings.public_path&&!publicDetail)fail(404,'页面不存在');
        if(publicFiles.has(file)){res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');if(file==='index.html'||file==='public.html'){const attr=admin?'data-admin-path="'+settings.admin_path+'"':'data-public-path="'+settings.public_path+'"';let html=publicFiles.get(file).toString().replace(/<body([^>]*)>/,'<body$1 '+attr+'>');if(admin)html=html.replace('<form id="login-form"','<form id="login-form" action="'+settings.admin_path+'/api/login"');return res.end(html);}return res.end(publicFiles.get(file));}
      }
      fail(404,'页面不存在');
    } catch(e) { if(!res.headersSent) send(res,e.status??500,{error:e.status?e.message:'服务器内部错误'});else res.end(); if(!e.status) console.error('Request failed:',options.debugErrors?e.stack:e.name); }
  });
  server.requestTimeout=120000; server.headersTimeout=10000; server.maxConnections=256;
  const tick=setInterval(()=>notifications().catch(e=>console.error('Notification worker:',e.name)),5000);tick.unref();
  const flush=setInterval(()=>{if(!restoring)for(const [id,live] of latest) flushMinute(id,live);},60000);flush.unref();
  const remoteTick=setInterval(()=>{if(!closed&&!restoring)remoteBackup.tick().catch(()=>{});},60000);remoteTick.unref();
  const extrasTick=setInterval(async()=>{if(closed||restoring)return;await fx.refresh();if(closed||restoring)return;const today=dayKey(new Date(),settings.timezone);if(settings.backup_enabled&&!backups.busy&&db.prepare("SELECT value FROM settings WHERE key='last_backup'").get()?.value!==today){try{await backups.create('daily');db.prepare("INSERT INTO settings VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today);}catch(e){console.error('Backup:',e.name);}}},3600000);extrasTick.unref();
  if(!options.disableExternal&&!options.disableTelegram)fx.refresh().catch(()=>{});
  const maintenance=setInterval(()=>{
    if(restoring)return;
    const stamp=now();
    for(const [id,s] of sessions) if(s.expires<stamp) sessions.delete(id);
    loginLimiter.prune();
    db.prepare('DELETE FROM minutes WHERE minute<?').run(stamp-settings.trend_days*86400);
    db.prepare('DELETE FROM daily WHERE date<?').run(dayKey(new Date((stamp-settings.keep_days*86400)*1000),settings.timezone));
    db.prepare("DELETE FROM outbox WHERE status='sent' AND created<?").run(stamp-90*86400);
  },3600000);maintenance.unref();
  return {server,remoteBackup,get db(){return db;},snapshot,notifications,close:async()=>{closed=true;agentBatch.cancel();forwardBatch.cancel();ssh.cancelAll();clearInterval(tick);clearInterval(flush);clearInterval(maintenance);clearInterval(extrasTick);clearInterval(remoteTick);await remoteBackup.close();if(db.isOpen)for(const [id,l] of latest){db.prepare('UPDATE nodes SET last_seen=? WHERE id=?').run(l.received,id);flushMinute(id,l);}await new Promise(r=>server.close(r));while(workerBusy||fx.busy||backups.busy)await new Promise(r=>setTimeout(r,50));if(db.isOpen)db.close();}};
}
function formatBytes(bytes) {const units=['B','KiB','MiB','GiB','TiB'];let i=0;while(bytes>=1024&&i<4){bytes/=1024;i++;}return bytes.toFixed(1)+' '+units[i];}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const app=await createApp();
  app.server.listen(Number(process.env.PORT ?? 8080),process.env.HOST ?? '127.0.0.1',()=>console.log(`Firefly Probe 0.2.32 listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 8080}`));
  let stopping=false;for(const sig of ['SIGINT','SIGTERM']) process.on(sig,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
}
