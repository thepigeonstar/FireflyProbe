import http from 'node:http';
import { readFileSync, createReadStream, statSync, rmSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve, join, dirname } from 'node:path';
import { randomBytes, randomUUID, createHash, timingSafeEqual, scrypt } from 'node:crypto';
import { promisify } from 'node:util';
import { openStore, dayKey, validDate, dailyTotals } from './store.mjs';
import { brandDefaults, brandView, validateBrand } from './brand.mjs';
import { createRates, nodeCost, costSummary } from './costs.mjs';
import { alarmDefaults, inQuiet, processAlarms } from './alarms.mjs';
import { createBackups, backupName, receiveRestore } from './backups.mjs';
import { createVault, createSSH, sshFields } from './ssh.mjs';
import {notificationSelected,validateTargets} from './notification-targets.mjs';

const derive = promisify(scrypt);
const sha = s => createHash('sha256').update(s).digest('hex');
const token = () => randomBytes(32).toString('hex');
const defaults = { timezone: 'Asia/Shanghai', interval: 5, offline_seconds: 45, keep_days: 180, trend_days: 7, report_enabled: false, report_hour: 8, report_minute: 0, thresholds: [80, 90, 95], telegram_token: '', telegram_chat: '' };
const staticDir = fileURLToPath(new URL('../web/', import.meta.url));
const publicFiles = new Map(['index.html', 'app.js', 'features.js','style.css','features.css','management.js','management.css', 'firefly.svg','public.html','public.js'].map(f => [f, readFileSync(join(staticDir, f))]));
const downloads = new Map([
  ['/install-agent.sh', fileURLToPath(new URL('../agent/bootstrap.sh', import.meta.url))],
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
  const n = {
    name: textValue(data.name, 80, '名称'), group_name: textValue(data.group_name ?? '', 40, '分组'),
    interface: textValue(data.interface ?? '', 40, '网卡'), sort: finite(data.sort ?? 0, -10000, 10000, '排序', true),
    quota: finite(data.quota ?? 0, 0, 8e15, '流量额度', true), billing_day: finite(data.billing_day ?? 1, 1, 31, '结算日', true),
    billing_mode: data.billing_mode ?? 'sum', expires: data.expires ?? '', enabled: data.enabled === false || data.enabled === 0 ? 0 : 1,
    cost_amount:finite(data.cost_amount??0,0,1e9,'付款金额'),cost_currency:textValue(data.cost_currency??'CNY',3,'币种').toUpperCase(),cost_months:finite(data.cost_months??1,1,120,'付款周期',true),cost_active:data.cost_active===false||data.cost_active===0?0:1,
    alerts_enabled:data.alerts_enabled===false||data.alerts_enabled===0?0:1,maintenance_until:finite(data.maintenance_until??0,0,1e12,'维护时间',true),public_visible:data.public_visible===true||data.public_visible===1?1:0
  };
  if (!n.name || (n.interface && !/^[a-zA-Z0-9_.:@-]+$/.test(n.interface)) || !['rx','tx','sum','max'].includes(n.billing_mode) || (n.expires && !validDate(n.expires))) fail(400, '节点配置无效');
  if(!/^[A-Z]{3}$/.test(n.cost_currency)||Math.abs(n.cost_amount*100-Math.round(n.cost_amount*100))>0.0001)fail(400,'金额最多两位小数，币种需为三位货币代码');
  return n;
}
function settingsFields(input, old) {
  const s = { ...old };
  try {Object.assign(s,validateBrand(input,old));} catch(e) {fail(400,e.message);}
  for (const k of ['timezone','telegram_token','telegram_chat']) if (input[k] !== undefined) s[k] = textValue(input[k], k === 'telegram_token' ? 150 : 80, k);
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
  for(const k of ['quiet_enabled','backup_enabled','public_enabled','public_show_metrics','public_show_traffic'])if(input[k]!==undefined){if(typeof input[k]!=='boolean')fail(400,'开关配置无效');s[k]=input[k];}
  for(const k of ['quiet_start','quiet_end'])if(input[k]!==undefined){if(typeof input[k]!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(input[k]))fail(400,'静默时间格式无效');s[k]=input[k];}
  if(input.expiry_days!==undefined){if(!Array.isArray(input.expiry_days)||input.expiry_days.length>8)fail(400,'最多八个到期提醒时间');s.expiry_days=[...new Set(input.expiry_days.map(x=>finite(x,0,90,'提前提醒天数',true)))].sort((a,b)=>b-a);}
  if(input.notification_targets!==undefined){try{s.notification_targets=validateTargets(input.notification_targets);}catch(e){fail(400,e.message);}}
  return s;
}

export async function createApp(options = {}) {
  const password = options.password ?? process.env.ADMIN_PASSWORD;
  if (!password || password.length < 12 || password.includes('REPLACE_WITH')) throw new Error('请设置至少 12 位的 ADMIN_PASSWORD，不能使用示例占位密码');
  const username = options.username ?? process.env.ADMIN_USER ?? 'admin';
  const salt = randomBytes(16), passwordHash = await derive(password, salt, 64);
  const dbPath=resolve(options.dbPath ?? join(process.env.DATA_DIR ?? 'data', 'lightprobe.sqlite'));
  const db = openStore(dbPath);let restoring=false,restoreEpoch=0,publicCache=null;
  const initial = { ...defaults, ...brandDefaults,...alarmDefaults, timezone: process.env.TIMEZONE || defaults.timezone };
  new Intl.DateTimeFormat('en', { timeZone: initial.timezone });
  const savedSettings=db.prepare("SELECT value FROM settings WHERE key='config'").get();
  let settings = { ...initial, ...JSON.parse(savedSettings?.value ?? '{}') };
  if(!savedSettings)db.prepare("INSERT INTO settings VALUES('config',?)").run(JSON.stringify(settings));
  const sessions = new Map(), latest = new Map(), loginLimits = new Map(), noticeState = new Map();
  const fx=createRates(()=>db,{disableExternal:options.disableExternal??options.disableTelegram,fetchRates:options.fetchRates});
  const backups=createBackups(()=>db,dirname(dbPath),()=>settings);
  let loggingIn = 0, workerBusy = false, closed = false,notificationGraceUntil=0;
  const secure = options.secureCookies ?? process.env.COOKIE_SECURE === 'true';
  const publicURL = options.publicURL ?? process.env.PUBLIC_URL ?? '';
  if (secure && !publicURL.startsWith('https://')) throw new Error('安全 Cookie 模式需要 HTTPS PUBLIC_URL');
  let appOrigin = publicURL ? new URL(publicURL).origin : '';
  const vault=createVault(dirname(dbPath));
  const ssh=createSSH({db,vault,publicURL,bootstrap:readFileSync(fileURLToPath(new URL('../agent/bootstrap.sh',import.meta.url)),'utf8'),ClientClass:options.sshClient});
  function configuredNode(input,old={},id=old.id) {
    const fields={...nodeFields({...old,...input}),...sshFields(input,old)};
    if(input.ssh_password!==undefined){if(typeof input.ssh_password!=='string'||input.ssh_password.length>1024||input.ssh_password.includes('\0'))fail(400,'SSH 密码格式无效');if(input.ssh_password)fields.ssh_password=vault.seal(input.ssh_password,id);}
    if(input.ssh_clear===true)fields.ssh_password='';
    if(fields.ssh_host!==(old.ssh_host??'')||fields.ssh_port!==(old.ssh_port??22))fields.ssh_fingerprint='';
    return fields;
  }
  const now = () => Math.floor(Date.now()/1000);
  const getNodes = () => db.prepare('SELECT * FROM nodes ORDER BY sort,name').all();
  const safeSettings = () => ({ ...settings, brand_logo:undefined, brand_favicon:undefined, telegram_token: undefined, telegram_configured: Boolean(settings.telegram_token && settings.telegram_chat) });
  const editableSettings = () => ({ ...settings, telegram_configured: Boolean(settings.telegram_token && settings.telegram_chat) });
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
      const { token_hash,ssh_password,agent_secret, ...safe } = n;
      safe.ssh_configured=Boolean(ssh_password);
      safe.ssh_job=ssh.recent(n.id);
      return { ...safe, last_version:live?.metrics?.version??n.last_version, last_seen: seen, status, metrics: status === 'online' ? live?.metrics ?? null : null, traffic: dailyTotals(db,n,today), cost:nodeCost(n,rates), expired: Boolean(n.expires && n.expires < today),maintenance:n.maintenance_until>now() };
    });
  };
  const publicHistoryCache=new Map();
  function publicHistory(id='network',admin=false){
    if(!admin&&(!settings.public_enabled||!settings.public_show_metrics))fail(404,'公开网速记录尚未启用');
    const node=id==='network'?null:db.prepare('SELECT id,name,public_visible FROM nodes WHERE id=?').get(id);
    if(id!=='network'&&(!node||(!admin&&!node.public_visible)))fail(404,'公开服务器不存在');
    const visibleNodes=getNodes().filter(n=>(admin||n.public_visible)&&(node?n.id===id:n.enabled)),signature=JSON.stringify(visibleNodes.map(n=>[n.id,n.name,n.enabled]));
    const cacheKey=(admin?'admin:':'')+id,stamp=now(),cached=publicHistoryCache.get(cacheKey);if(cached&&stamp-cached.stamp<15&&cached.signature===signature)return cached.data;
    const start=stamp-86400,filter=node?'n.id=?'+(admin?'':' AND n.public_visible=1'):(admin?'n.enabled=1':'n.public_visible=1 AND n.enabled=1'),params=node?[start,stamp,id]:[start,stamp];
    const rows=db.prepare('SELECT m.minute,SUM(m.rx/m.count) rx,SUM(m.tx/m.count) tx FROM minutes m JOIN nodes n ON n.id=m.node_id WHERE m.minute>=? AND m.minute<=? AND '+filter+' GROUP BY m.minute ORDER BY m.minute').all(...params);
    const byMinute=new Map(rows.map(row=>[row.minute,{...row}]));
    const visible=new Set(visibleNodes.map(n=>n.id));
    for(const [nodeId,live] of latest){if(!visible.has(nodeId)||live.minute<start||live.minute>stamp)continue;const stored=db.prepare('SELECT rx/count rx,tx/count tx FROM minutes WHERE node_id=? AND minute=?').get(nodeId,live.minute),a=live.aggregate,row=byMinute.get(live.minute)||{minute:live.minute,rx:0,tx:0};row.rx+=a.rx/a.count-(stored?.rx||0);row.tx+=a.tx/a.count-(stored?.tx||0);byMinute.set(live.minute,row);}
    const data={brand:brandView(settings),id:node?.id??'network',name:node?.name??'当前总网速',hours:24,start,server_time:stamp,minutes:[...byMinute.values()].sort((a,b)=>a.minute-b.minute).map(r=>({minute:r.minute,rx:Math.max(0,r.rx),tx:Math.max(0,r.tx)}))};publicHistoryCache.set(cacheKey,{stamp,data,signature});if(publicHistoryCache.size>201)publicHistoryCache.delete(publicHistoryCache.keys().next().value);return data;
  }
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
      const stamp = now(), today = dayKey(new Date(),settings.timezone), nodes = snapshot();
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
        const lines = nodes.filter(n=>n.enabled&&notificationSelected(settings,'report',n.id)).map(n=>`${n.status==='online'?'🟢':'🔴'} ${n.name}\n昨日 ${formatBytes(n.traffic.yesterday.rx+n.traffic.yesterday.tx)} · 周期 ${formatBytes(n.traffic.measured)}${n.quota ? ' / '+formatBytes(n.quota):''}${n.history_error || !n.history_seen || stamp-n.history_seen>900 ? '\n⚠️ 流量数据未同步或异常':''}`);
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
      db.exec('COMMIT');
    } catch(e) { db.exec('ROLLBACK'); throw e; }
    const a=previous?.minute===minute?previous.aggregate:{rx:0,tx:0,cpu:0,mem:0,count:0};
    a.rx+=metrics.rx_speed;a.tx+=metrics.tx_speed;a.cpu+=metrics.cpu;a.mem+=metrics.mem_total?metrics.mem_used/metrics.mem_total*100:0;a.count++;
    latest.set(node.id,{received:stamp,minute,metrics,aggregate:a});
  }
  async function body(req) {
    const epoch=restoreEpoch;let bytes=0; const chunks=[];
    for await (const chunk of req) { bytes+=chunk.length; if(bytes>256*1024) fail(413,'请求过大'); chunks.push(chunk); }
    if(restoring)fail(503,'正在恢复备份，请稍后重试');
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
    if(backups.busy||restoring||getNodes().some(n=>ssh.busy(n.id)))fail(409,'已有备份、恢复或 SSH 部署正在进行');
    const epoch=restoreEpoch,incoming=dbPath+'.incoming-'+randomUUID();let ownsLock=false;
    try {
      await receiveRestore(req,incoming);
      // Validate and migrate the candidate before touching the running database.
      const candidate=openStore(incoming);
      try {
        const saved=JSON.parse(candidate.prepare("SELECT value FROM settings WHERE key='config'").get()?.value??'{}');
        settingsFields({...initial,...saved},{...initial,...saved});
        const nodes=candidate.prepare('SELECT * FROM nodes').all();if(nodes.length>200)fail(400,'备份节点超过 200 台');for(const n of nodes){nodeFields(n);sshFields(n);if(typeof n.ssh_fingerprint!=="string"||n.ssh_fingerprint&& !/^SHA256:[A-Za-z0-9+/]{43}$/.test(n.ssh_fingerprint))fail(400,"备份 SSH 指纹无效");}
      }finally{candidate.close();}
      if(restoring||backups.busy||epoch!==restoreEpoch||getNodes().some(n=>ssh.busy(n.id)))fail(409,'已有恢复或部署操作，请稍后重试');
      restoring=true;
      ownsLock=true;
      while(workerBusy||fx.busy)await new Promise(r=>setTimeout(r,20));
      for(const [id,l] of latest){flushMinute(id,l);db.prepare('UPDATE nodes SET last_seen=? WHERE id=?').run(l.received,id);}
      await backups.create('before-restore');
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
          db.exec('DELETE FROM alerts');
          db.exec("UPDATE sqlite_sequence SET seq=(SELECT COALESCE(MAX(id),0) FROM outbox) WHERE name='outbox'; COMMIT;");
        }catch(e){db.exec('ROLLBACK');throw e;}
      }finally{db.exec('DETACH DATABASE restored');}
      settings={...initial,...JSON.parse(db.prepare("SELECT value FROM settings WHERE key='config'").get()?.value??'{}')};
      notificationGraceUntil=now()+settings.offline_seconds;
      restoreEpoch++;ssh.reset();publicHistoryCache.clear();
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
      if(method==='GET'&&path==='/api/public/history')return send(res,200,publicHistory());
      const publicNodeHistory=/^\/api\/public\/nodes\/([a-f0-9-]{36})\/history$/.exec(path);if(method==='GET'&&publicNodeHistory)return send(res,200,publicHistory(publicNodeHistory[1]));
      if(method==='GET'&&path==='/api/public') {
        if(!settings.public_enabled)fail(404,'公开展示尚未启用');
        if(!publicCache||now()-publicCache.created>=5){const nodes=snapshot().filter(n=>n.public_visible).map(n=>({id:n.id,name:n.name,group_name:n.group_name,status:n.status,last_seen:n.last_seen,metrics:settings.public_show_metrics&&n.metrics?{rx_speed:n.metrics.rx_speed,tx_speed:n.metrics.tx_speed,cpu:n.metrics.cpu,mem_percent:n.metrics.mem_total?n.metrics.mem_used/n.metrics.mem_total*100:0,disk_percent:n.metrics.disk_total?n.metrics.disk_used/n.metrics.disk_total*100:0}:undefined,traffic:settings.public_show_traffic?{today:n.traffic.today.rx+n.traffic.today.tx,month:n.traffic.month.rx+n.traffic.month.tx}:undefined}));publicCache={created:now(),payload:{brand:brandView(settings),nodes,network:settings.public_show_metrics?nodes.filter(n=>n.status!=='disabled').reduce((total,n)=>({rx:total.rx+(n.metrics?.rx_speed||0),tx:total.tx+(n.metrics?.tx_speed||0)}),{rx:0,tx:0}):undefined,show_network:settings.public_show_metrics,server_time:now()}};}
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
        if(method==='POST'&&path==='/api/agent/report') { ingest(node,await body(req)); return send(res,200,{ok:true}); }
        fail(404,'接口不存在');
      }
      if(method==='POST'&&path==='/api/login') {
        if(req.headers.origin && appOrigin && req.headers.origin!==appOrigin) fail(403,'来源无效');
        const ip=req.socket.remoteAddress ?? 'unknown';
        let limit=loginLimits.get(ip); if(!limit||limit.until<now()) { limit={count:0,until:now()+300}; if(loginLimits.size>=1000) loginLimits.delete(loginLimits.keys().next().value); loginLimits.set(ip,limit); }
        if(++limit.count>15 || loggingIn>=3) fail(429,'登录尝试过多，请五分钟后再试');
        const data=await body(req); if(typeof data.password!=='string'||data.password.length>256) fail(400,'密码无效');
        loggingIn++; let candidate; try {candidate=await derive(data.password,salt,64);} finally {loggingIn--;}
        if(data.username!==username||!timingSafeEqual(candidate,passwordHash)) fail(401,'用户名或密码错误');
        const id=token(),csrf=token(); if(sessions.size>=500) sessions.delete(sessions.keys().next().value);
        sessions.set(id,{csrf,expires:now()+43200});
        res.setHeader('Set-Cookie',`lp_session=${id}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${secure?'; Secure':''}`);
        return send(res,200,{csrf,username});
      }
      if(path.startsWith('/api/')) {
        const session=auth(req,method!=='GET');
        if(path==='/api/session'&&method==='GET') return send(res,200,{csrf:session.csrf,username});
        if(path==='/api/logout'&&method==='POST') {sessions.delete(session.cookie);res.setHeader('Set-Cookie','lp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true});}
        const sshRoute=/^\/api\/nodes\/([a-f0-9-]{36})\/ssh\/(probe|trust|test|deploy)$/.exec(path);
        if(sshRoute&&method==='POST'){const [unused,id,action]=sshRoute;if(action==='probe')return send(res,200,await ssh.probe(id));if(action==='trust'){const input=await body(req);ssh.trust(id,input.fingerprint);return send(res,200,{ok:true});}if(action==='test')return send(res,200,await ssh.test(id));return send(res,202,ssh.deploy(id));}
        const jobRoute=/^\/api\/ssh\/jobs\/([a-f0-9-]{36})$/.exec(path);if(jobRoute&&method==='GET')return send(res,200,ssh.status(jobRoute[1]));
        if(path==='/api/nodes'&&method==='GET') {const rates=fx.read();const {rates:unused,...fxInfo}=rates;return send(res,200,{nodes:snapshot(),settings:safeSettings(),cost_summary:costSummary(getNodes(),rates),fx_info:fxInfo,server_time:now(),version:'0.2.2',agent_version:'0.2.0'});}
        if(path==='/api/network/history'&&method==='GET')return send(res,200,publicHistory('network',true));
        if(path==='/api/costs'&&method==='GET')return send(res,200,{...costSummary(getNodes(),fx.read()),fx:fx.read()});
        if(path==='/api/fx/refresh'&&method==='POST')return send(res,200,await fx.refresh(true));
        if(path==='/api/backups'&&method==='GET')return send(res,200,backups.list());
        if(path==='/api/backups'&&method==='POST'){for(const [id,l] of latest){flushMinute(id,l);db.prepare('UPDATE nodes SET last_seen=?,last_version=? WHERE id=?').run(l.received,l.metrics.version,id);}return send(res,201,await backups.create());}
        const download=/^\/api\/backups\/([^/]+)$/.exec(path);
        if(download&&method==='GET'){if(!backupName.test(download[1])||!backups.list().some(x=>x.name===download[1]))fail(404,'备份不存在');const file=join(backups.directory,download[1]);res.setHeader('Content-Type','application/vnd.sqlite3');res.setHeader('Content-Disposition',`attachment; filename="${download[1]}"`);res.setHeader('Content-Length',statSync(file).size);await pipeline(createReadStream(file),res);return;}
        if(path==='/api/backups/restore'&&method==='POST'){await restoreBackup(req);fx.refresh().catch(()=>{});res.setHeader('Set-Cookie','lp_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');return send(res,200,{ok:true,message:'备份已恢复，请重新登录'});}
        if(path==='/api/nodes'&&method==='POST') {
          if(getNodes().length>=200) fail(400,'首版最多支持 200 台机器');
          const input=await body(req),id=randomUUID(),secret=token(),n=configuredNode(input,{},id);
          const fields={id,token_hash:sha(secret),agent_secret:vault.seal(secret,id),...n,created:now()};db.prepare(`INSERT INTO nodes(${Object.keys(fields).join(',')}) VALUES(${Object.keys(fields).map(()=>'?').join(',')})`).run(...Object.values(fields));
          publicCache=null;
          return send(res,201,{id,token:secret,public_url:publicURL});
        }
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
          if(!match[2]&&method==='DELETE') {if(ssh.busy(node.id))fail(409,'部署中不能删除服务器');db.prepare('DELETE FROM nodes WHERE id=?').run(node.id);latest.delete(node.id);noticeState.delete(node.id);publicCache=null;return send(res,200,{ok:true});}
        }
        if(path==='/api/settings'&&method==='GET') return send(res,200,editableSettings());
        if(path==='/api/settings'&&method==='PUT') {const input=await body(req),updated=settingsFields(input,settings);if(input.notification_targets!==undefined){const reportChanged=JSON.stringify(settings.notification_targets?.report??null)!==JSON.stringify(updated.notification_targets.report);for(const job of db.prepare("SELECT id,event_key FROM outbox WHERE status='pending'").all()){const [kind,id]=job.event_key.split(':'),type=({quota:'quota',offline:'offline',recovery:'offline',resource:'resource','resource-recovery':'resource',expiry:'expiry',expired:'expiry'})[kind];if((kind==='daily'&&reportChanged)||(type&&!notificationSelected(updated,type,id)))db.prepare("UPDATE outbox SET event_key=event_key||?,status='failed',error='通知服务器范围调整，已取消待发送通知' WHERE id=?").run(':scope-'+randomUUID(),job.id);}}db.prepare("INSERT INTO settings VALUES('config',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(updated));settings=updated;publicCache=null;return send(res,200,editableSettings());}
        if(path==='/api/notifications'&&method==='GET') return send(res,200,db.prepare('SELECT id,status,attempts,created,sent,error FROM outbox ORDER BY id DESC LIMIT 30').all());
        if(path==='/api/notifications/test'&&method==='POST') {if(!enqueue(`test:${randomUUID()}`,`✅ ${settings.brand_name} 通知测试成功`)) fail(400,'请先配置 Telegram Token 和 Chat ID');return send(res,200,{ok:true,message:'已加入发送队列，请稍后查看状态'});}
        fail(404,'接口不存在');
      }
      if(method==='GET') {
        const file=path==='/'?'index.html':(path==='/public'||path==='/public/network'||/^\/public\/servers\/[a-f0-9-]{36}$/.test(path))?'public.html':path.slice(1);
        if(publicFiles.has(file)) {res.setHeader('Content-Type',file.endsWith('.svg')?'image/svg+xml':file.endsWith('.js')?'text/javascript; charset=utf-8':file.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8');return res.end(publicFiles.get(file));}
      }
      fail(404,'页面不存在');
    } catch(e) { if(!res.headersSent) send(res,e.status??500,{error:e.status?e.message:'服务器内部错误'});else res.end(); if(!e.status) console.error('Request failed:',options.debugErrors?e.stack:e.name); }
  });
  server.requestTimeout=120000; server.headersTimeout=10000; server.maxConnections=256;
  const tick=setInterval(()=>notifications().catch(e=>console.error('Notification worker:',e.name)),5000);tick.unref();
  const flush=setInterval(()=>{if(!restoring)for(const [id,live] of latest) flushMinute(id,live);},60000);flush.unref();
  const extrasTick=setInterval(async()=>{if(closed||restoring)return;await fx.refresh();if(closed||restoring)return;const today=dayKey(new Date(),settings.timezone);if(settings.backup_enabled&&!backups.busy&&db.prepare("SELECT value FROM settings WHERE key='last_backup'").get()?.value!==today){try{await backups.create('daily');db.prepare("INSERT INTO settings VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(today);}catch(e){console.error('Backup:',e.name);}}},3600000);extrasTick.unref();
  if(!options.disableExternal&&!options.disableTelegram)fx.refresh().catch(()=>{});
  const maintenance=setInterval(()=>{
    if(restoring)return;
    const stamp=now();
    for(const [id,s] of sessions) if(s.expires<stamp) sessions.delete(id);
    for(const [id,v] of loginLimits) if(v.until<stamp) loginLimits.delete(id);
    db.prepare('DELETE FROM minutes WHERE minute<?').run(stamp-settings.trend_days*86400);
    db.prepare('DELETE FROM daily WHERE date<?').run(dayKey(new Date((stamp-settings.keep_days*86400)*1000),settings.timezone));
    db.prepare("DELETE FROM outbox WHERE status='sent' AND created<?").run(stamp-90*86400);
  },3600000);maintenance.unref();
  return {server,get db(){return db;},snapshot,notifications,close:async()=>{closed=true;ssh.cancelAll();clearInterval(tick);clearInterval(flush);clearInterval(maintenance);clearInterval(extrasTick);if(db.isOpen)for(const [id,l] of latest){db.prepare('UPDATE nodes SET last_seen=? WHERE id=?').run(l.received,id);flushMinute(id,l);}await new Promise(r=>server.close(r));while(workerBusy||fx.busy||backups.busy)await new Promise(r=>setTimeout(r,50));if(db.isOpen)db.close();}};
}
function formatBytes(bytes) {const units=['B','KiB','MiB','GiB','TiB'];let i=0;while(bytes>=1024&&i<4){bytes/=1024;i++;}return bytes.toFixed(1)+' '+units[i];}
if(process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  const app=await createApp();
  app.server.listen(Number(process.env.PORT ?? 8080),process.env.HOST ?? '127.0.0.1',()=>console.log(`Firefly Probe 0.2.0 listening on ${process.env.HOST ?? '127.0.0.1'}:${process.env.PORT ?? 8080}`));
  let stopping=false;for(const sig of ['SIGINT','SIGTERM']) process.on(sig,async()=>{if(stopping)return;stopping=true;await app.close();process.exit(0);});
}
