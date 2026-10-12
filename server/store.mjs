import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export function openStore(file) {
  mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
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
    PRAGMA user_version=1;`);
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
  return { today: total(r => r.date === today), yesterday: total(r => r.date === yesterday), month: total(r => r.date.slice(0, 7) === today.slice(0, 7)), cycle, measured, ratio: node.quota > 0 ? measured / node.quota * 100 : null, bounds };
}
