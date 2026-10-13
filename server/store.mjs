import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, existsSync, chmodSync } from 'node:fs';
import { dirname, join } from 'node:path';

export function openStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  const schemaVersion = db.prepare('PRAGMA user_version').get().user_version;
  if(schemaVersion>3) {db.close();throw new Error('数据库来自更高版本，请升级主控后再读取');}
  // Preserve a consistent pre-migration snapshot when opening a v1 database.
  if(schemaVersion===1||schemaVersion===2) {
    const backupDir=join(dirname(file),'backups');mkdirSync(backupDir,{recursive:true,mode:0o700});
    const copy=join(backupDir,'migration-v'+schemaVersion+'-'+Date.now()+'.sqlite');
    if(!existsSync(copy)){db.prepare('VACUUM INTO ?').run(copy);chmodSync(copy,0o600);}
  }
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=3000;
    CREATE TABLE IF NOT EXISTS nodes (
      id TEXT PRIMARY KEY, token_hash TEXT UNIQUE NOT NULL, name TEXT NOT NULL, group_name TEXT NOT NULL DEFAULT '',
      sort INTEGER NOT NULL DEFAULT 0, interface TEXT NOT NULL DEFAULT '', quota REAL NOT NULL DEFAULT 0,
      billing_day INTEGER NOT NULL DEFAULT 1, billing_mode TEXT NOT NULL DEFAULT 'sum', expires TEXT NOT NULL DEFAULT '',
      enabled INTEGER NOT NULL DEFAULT 1, created INTEGER NOT NULL, last_seen INTEGER NOT NULL DEFAULT 0,
      history_seen INTEGER NOT NULL DEFAULT 0, history_error TEXT NOT NULL DEFAULT '', history_timezone TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS daily (
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, interface TEXT NOT NULL,
      date TEXT NOT NULL, rx INTEGER NOT NULL, tx INTEGER NOT NULL, PRIMARY KEY(node_id,interface,date)
    );
    CREATE TABLE IF NOT EXISTS minutes (
      node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, minute INTEGER NOT NULL,
      rx REAL NOT NULL, tx REAL NOT NULL, cpu REAL NOT NULL, mem REAL NOT NULL, count INTEGER NOT NULL,
      PRIMARY KEY(node_id,minute)
    );
    CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS outbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_key TEXT UNIQUE NOT NULL, message TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_try INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL, sent INTEGER, error TEXT NOT NULL DEFAULT ''
    );
    `);
  const columns=new Set(db.prepare('PRAGMA table_info(nodes)').all().map(x=>x.name));
  for(const [name,type] of Object.entries({cost_amount:'REAL NOT NULL DEFAULT 0',cost_currency:"TEXT NOT NULL DEFAULT 'CNY'",cost_months:'INTEGER NOT NULL DEFAULT 1',cost_active:'INTEGER NOT NULL DEFAULT 1',alerts_enabled:'INTEGER NOT NULL DEFAULT 1',maintenance_until:'INTEGER NOT NULL DEFAULT 0',public_visible:'INTEGER NOT NULL DEFAULT 0',last_version:"TEXT NOT NULL DEFAULT ''",ssh_host:"TEXT NOT NULL DEFAULT ''",ssh_port:'INTEGER NOT NULL DEFAULT 22',ssh_user:"TEXT NOT NULL DEFAULT 'root'",ssh_password:"TEXT NOT NULL DEFAULT ''",ssh_fingerprint:"TEXT NOT NULL DEFAULT ''",agent_secret:"TEXT NOT NULL DEFAULT ''",country_override:"TEXT NOT NULL DEFAULT ''",country_code:"TEXT NOT NULL DEFAULT ''",country_ip:"TEXT NOT NULL DEFAULT ''"})) {
    if(!columns.has(name))db.exec(`ALTER TABLE nodes ADD COLUMN ${name} ${type}`);
  }
  db.exec('CREATE TABLE IF NOT EXISTS alerts (node_id TEXT NOT NULL REFERENCES nodes(id) ON DELETE CASCADE, kind TEXT NOT NULL, since INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(node_id,kind)); PRAGMA user_version=3;');
  return db;
}

export function dayKey(date, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(date);
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}
export function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s;
}
export function billingBounds(today, day) {
  const [y, m, d] = today.split('-').map(Number);
  const inMonth = (year, month) => {
    const base = new Date(Date.UTC(year, month - 1, 1));
    const max = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
    base.setUTCDate(Math.min(day, max));
    return base.toISOString().slice(0, 10);
  };
  const start = inMonth(y, m);
  return d >= Number(start.slice(-2)) ? { start, end: inMonth(y, m + 1) } : { start: inMonth(y, m - 1), end: start };
}
export function usedTraffic(rx, tx, mode) { return mode === 'rx' ? rx : mode === 'tx' ? tx : mode === 'max' ? Math.max(rx, tx) : rx + tx; }
export function dailyTotals(db, node, today) {
  const bounds = billingBounds(today, node.billing_day);
  const yesterday = new Date(Date.parse(today) - 86400000).toISOString().slice(0, 10);
  const rows = db.prepare('SELECT date,SUM(rx) rx,SUM(tx) tx FROM daily WHERE node_id=? AND date>=? AND date<=? GROUP BY date ORDER BY date').all(node.id, [bounds.start, today.slice(0, 7) + '-01', yesterday].sort()[0], today);
  const total = predicate => rows.filter(predicate).reduce((t, r) => ({ rx: t.rx + r.rx, tx: t.tx + r.tx }), { rx: 0, tx: 0 });
  const cycle = total(r => r.date >= bounds.start && r.date < bounds.end);
  const measured = usedTraffic(cycle.rx, cycle.tx, node.billing_mode);
  const recent=rows.filter(r=>r.date<today&&r.date>=bounds.start&&Date.parse(r.date)>=Date.parse(today)-7*864e5);
  const sum=recent.reduce((s,r)=>({rx:s.rx+r.rx,tx:s.tx+r.tx}),{rx:0,tx:0});
  const average=recent.length>=3?usedTraffic(sum.rx/recent.length,sum.tx/recent.length,node.billing_mode):null;
  const remaining=node.quota>0?Math.max(0,node.quota-measured):null;
  const forecast=node.quota>0&&average>0?new Date(Date.parse(today)+Math.ceil(remaining/average)*864e5).toISOString().slice(0,10):null;
  return { today: total(r => r.date === today), yesterday: total(r => r.date === yesterday), month: total(r => r.date.slice(0, 7) === today.slice(0, 7)), cycle, measured, ratio: node.quota > 0 ? measured / node.quota * 100 : null, bounds, remaining, days_remaining:Math.max(0,Math.round((Date.parse(bounds.end)-Date.parse(today))/864e5)), forecast:forecast&&forecast<bounds.end?forecast:null, daily_average:average, forecast_samples:recent.length };
}
