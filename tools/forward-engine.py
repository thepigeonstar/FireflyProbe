#!/usr/bin/env python3
"""Root-only GOST engine controller. API never leaves loopback; no daemon in Python."""
import base64
import copy
import json
import math
import os
import pathlib
import re
import secrets
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path('/etc/firefly-forward-engine')
MANIFESTS = pathlib.Path('/etc/firefly-forward')
BACKUPS = pathlib.Path('/var/backups/firefly-forward')
UNIT = 'firefly-forward-engine'
BINARY = '/opt/firefly-forward/gost-3.3.0'
HELPER = '/opt/firefly-forward/engine.py'
UUID = re.compile(r'^[a-f0-9-]{36}$')
METRIC = re.compile(r'^(gost_service_transfer_input_bytes_total|gost_service_transfer_output_bytes_total|gost_service_handler_errors_total)(?:\{(.*)\})?\s+(\S+)(?:\s+\d+)?$')
SERVICE = re.compile(r'(?:^|,)\s*service="((?:\\.|[^"\\])*)"(?:,|$)')


def write(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    with open(str(path)+'.new', 'w', encoding='utf-8') as f:
        json.dump(value, f, ensure_ascii=True)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(str(path)+'.new', 0o600)
    os.replace(str(path)+'.new', path)


def read(path):
    with open(path, encoding='utf-8') as f:
        return json.load(f)


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def http(port, path, method='GET', value=None, password=None):
    headers = {'Content-Type': 'application/json'}
    if password:
        headers['Authorization'] = 'Basic '+base64.b64encode(('firefly:'+password).encode()).decode()
    request = urllib.request.Request('http://127.0.0.1:%d%s' % (port, path), data=None if value is None else json.dumps(value).encode(), headers=headers, method=method)
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    with opener.open(request, timeout=5) as response:
        body = response.read(16*1024*1024+1)
    if len(body) > 16*1024*1024:
        raise RuntimeError('Metrics 超过 16 MiB，未执行切换')
    return body


def service_names(rule):
    return ['ff-'+rule['id']+'-'+rule['generation']+'-'+p for p in (['tcp', 'udp'] if rule['protocol']=='both' else [rule['protocol']])]


def services(rule):
    host = rule['target_host']
    if ':' in host:
        host = '['+host+']'
    return [{'name': name, 'addr': ':'+str(rule['listen_port']), 'handler': {'type': name.rsplit('-', 1)[1]}, 'listener': {'type': name.rsplit('-', 1)[1]}, 'forwarder': {'nodes': [{'name': 'target', 'addr': host+':'+str(rule['target_port'])}]}} for name in service_names(rule)]


def config(state):
    return {'services': [s for r in state['rules'].values() if r['active'] for s in services(r)], 'api': {'addr': '127.0.0.1:'+str(state['api_port']), 'auth': {'username': 'firefly', 'password': state['password']}}, 'metrics': {'addr': '127.0.0.1:'+str(state['metrics_port'])}}


def api(state, path, method='GET', value=None):
    body = http(state['api_port'], '/config/services'+path, method, value, state['password'])
    result = json.loads(body or b'{}')
    if isinstance(result, dict) and result.get('code', 0) != 0:
        raise RuntimeError('GOST API 拒绝操作')
    return result


def manifest(state, rule):
    return {'format': 2, 'id': rule['id'], 'epoch': str(uuid.uuid5(uuid.UUID(state['process_epoch']), rule['generation'])), 'port': state['metrics_port'], 'services': service_names(rule)}


def persist(state):
    write(ROOT/'state.json', state)
    write(ROOT/'config.json', config(state))
    for rule in state['rules'].values():
        write(MANIFESTS/(rule['id']+'.json'), manifest(state, rule))


def boot():
    state = read(ROOT/'state.json')
    state['process_epoch'] = str(uuid.uuid4())
    persist(state)
    os.execv(BINARY, [BINARY, '-C', str(ROOT/'config.json')])


def manager(action, unit=UNIT):
    if shutil.which('systemctl'):
        command = ['systemctl', 'enable', '--now', unit] if action=='start' else ['systemctl', 'disable', '--now', unit] if action=='stop' else ['systemctl', 'is-active', '--quiet', unit]
        result = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    else:
        if action in ('start', 'stop'):
            subprocess.run(['rc-update', 'add' if action=='start' else 'del', unit, 'default'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        result = subprocess.run(['rc-service', unit, action if action!='status' else 'status'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if action=='status':
        return result.returncode==0
    if result.returncode and not (action=='stop' and not manager('status', unit)):
        raise RuntimeError('系统服务操作失败：'+action)


def install_unit():
    wrapper = pathlib.Path('/opt/firefly-forward/run-engine.sh')
    wrapper.write_text('#!/bin/sh\nset -eu\numask 077\nexec python3 '+HELPER+' boot\n', encoding='utf-8')
    wrapper.chmod(0o755)
    if shutil.which('systemctl'):
        pathlib.Path('/etc/systemd/system/'+UNIT+'.service').write_text('[Unit]\nDescription=Firefly shared GOST engine\nAfter=network-online.target\nWants=network-online.target\n[Service]\nExecStart='+str(wrapper)+'\nRestart=on-failure\nRestartSec=5\nNoNewPrivileges=true\nPrivateTmp=true\nProtectSystem=strict\nProtectHome=true\nReadWritePaths=/etc/firefly-forward /etc/firefly-forward-engine\n[Install]\nWantedBy=multi-user.target\n', encoding='utf-8')
        subprocess.run(['systemctl', 'daemon-reload'], check=True)
    else:
        unit = pathlib.Path('/etc/init.d/'+UNIT)
        unit.write_text('#!/sbin/openrc-run\ndescription="Firefly shared GOST engine"\ncommand="'+str(wrapper)+'"\nsupervisor="supervise-daemon"\nrespawn_delay=5\nrespawn_max=0\ndepend() { need net; }\n', encoding='utf-8')
        unit.chmod(0o755)


def wait_ready():
    for _ in range(50):
        try:
            state = read(ROOT/'state.json')
            api(state, '')
            return state
        except (OSError, ValueError, RuntimeError):
            time.sleep(.1)
    raise RuntimeError('共享引擎 API 未就绪')


def validate(payload):
    if not UUID.fullmatch(payload.get('owner', '')) or not isinstance(payload.get('rules'), list) or len(payload['rules'])>200:
        raise RuntimeError('引擎请求无效')
    ids = set()
    for r in payload['rules']:
        if not UUID.fullmatch(r.get('id', '')) or r['id'] in ids or r.get('protocol') not in ('tcp', 'udp', 'both'):
            raise RuntimeError('规则标识无效')
        ids.add(r['id'])
        if any(type(r.get(k)) is not int or not 1<=r[k]<=65535 for k in ('listen_port', 'target_port')):
            raise RuntimeError('端口无效')
        if not isinstance(r.get('target_host'), str) or not re.fullmatch(r'[a-zA-Z0-9.:%_-]{1,253}', r['target_host']):
            raise RuntimeError('目标地址无效')


def snapshot(rule, path, emit=True):
    m = read(path)
    raw = http(m['port'], '/metrics').decode('utf-8')
    if 'gost_services' not in raw:
        raise RuntimeError('Metrics 无效，保留原部署')
    totals = dict(rx=0, tx=0, errors=0)
    names = set(m.get('services', []))
    for line in raw.splitlines():
        match = METRIC.fullmatch(line)
        if not match:
            continue
        if names:
            label = SERVICE.search(match.group(2) or '')
            if not label or json.loads('"'+label.group(1)+'"') not in names:
                continue
        value = float(match.group(3))
        if not math.isfinite(value) or not 0<=value<=8e15:
            raise RuntimeError('Metrics 计数无效')
        key = 'rx' if 'input_bytes' in match.group(1) else 'tx' if 'output_bytes' in match.group(1) else 'errors'
        totals[key] += int(value)
    if read(path) != m:
        raise RuntimeError('采样期间服务重启，请重试')
    sample = dict(id=rule['id'], epoch=m['epoch'], sampled=max(int(time.time()), rule.get('last_sampled', 0)+1), available=True, **totals)
    if emit:
        print('FIREFLY_FINAL '+json.dumps(sample, separators=(',', ':')), flush=True)
    return sample


def choose_port(excluded):
    while True:
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        if port not in excluded:
            return port


def add_services(state, rule):
    for s in services(rule):
        api(state, '', 'POST', s)
    listed = api(state, '')
    rows = listed.get('data', listed) if isinstance(listed, dict) else listed
    # GOST 3.x returns a service array under data.
    if isinstance(rows, dict):
        rows = rows.get('list', [])
    names = {s.get('name') for s in rows}
    if not set(service_names(rule)) <= names:
        raise RuntimeError('新增规则未通过 API 核对')


def delete_services(state, rule):
    listing = api(state, '')
    rows = listing.get('data', {}).get('list', [])
    present = {r['name'] for r in rows}
    for name in service_names(rule):
        if name in present:
            api(state, '/'+name, 'DELETE')


def migrate(payload):
    state_file = ROOT/'state.json'
    previous = read(state_file) if state_file.exists() else None
    if previous and previous['owner'] != payload['owner']:
        raise RuntimeError('共享引擎属于其他节点，拒绝覆盖')
    if previous and previous.get('mode')=='shared':
        expected = {r['id'] for r in payload['rules'] if r.get('installed')}
        if expected != set(previous['rules']):
            raise RuntimeError('主控与远端规则不一致，请先回退独立进程恢复')
        if not manager('status'):
            manager('start')
        wait_ready()
        print('共享进程已启用，保留当前规则和历史')
        return
    journal = ROOT/'migration.json'
    if journal.exists():
        recover_legacy(read(journal))
    rules = [r for r in payload['rules'] if r.get('installed')]
    known = {r['id'] for r in rules}
    extras = {p.stem for p in MANIFESTS.glob('*.json') if UUID.fullmatch(p.stem)}-known
    if extras:
        raise RuntimeError('远端有未归属本节点的转发清单，请先核对')
    saved = {'rules': rules, 'samples': {}, 'manifests': {r['id']: read(MANIFESTS/(r['id']+'.json')) for r in rules if (MANIFESTS/(r['id']+'.json')).exists()}}
    for r in rules:
        active = manager('status', 'firefly-forward-'+r['id'])
        if r['state']=='error':
            r['state'] = 'running' if active else 'stopped'
        if active != (r['state']=='running'):
            raise RuntimeError('规则实际启停与面板不一致，请先检查状态')
        if active:
            snapshot(r, MANIFESTS/(r['id']+'.json'), emit=False)
    write(journal, saved)
    backup = BACKUPS/(time.strftime('%Y%m%d-%H%M%S')+'-'+uuid.uuid4().hex[:8])
    backup.mkdir(parents=True, mode=0o700)
    write(backup/'legacy.json', saved)
    excluded = {r['listen_port'] for r in payload['rules']}
    api_port = choose_port(excluded)
    state = {'owner': payload['owner'], 'mode': 'migrating', 'api_port': api_port, 'metrics_port': choose_port(excluded|{api_port}), 'password': secrets.token_hex(32), 'process_epoch': str(uuid.uuid4()), 'rules': {}}
    def stop_legacy(rule):
        saved['samples'][rule['id']] = snapshot(rule, MANIFESTS/(rule['id']+'.json'))
        write(journal, saved)
        write(backup/'legacy.json', saved)
        manager('stop', 'firefly-forward-'+rule['id'])
    try:
        persist(state)
        install_unit()
        # Release one legacy process before starting the engine: avoid adding
        # another full GOST instance on an already memory-constrained host.
        anchor = next((r for r in rules if r['state']=='running'), None)
        if anchor:
            stop_legacy(anchor)
        manager('start')
        state = wait_ready()
        for r in rules:
            if r['state']=='running' and (not anchor or r['id']!=anchor['id']):
                stop_legacy(r)
            entry = {**r, 'generation': str(uuid.uuid4()), 'active': r['state']=='running'}
            if entry['active']:
                add_services(state, entry)
            state['rules'][r['id']] = entry
        state['mode'] = 'shared'
        persist(state)
        journal.unlink()
        print('已合并为一个 GOST 进程；原规则标识、启停状态和已保存流量历史保留。')
    except Exception:
        recover_legacy(saved)
        journal.unlink(missing_ok=True)
        raise


def recover_legacy(saved):
    manager('stop')
    for ident, m in saved['manifests'].items():
        write(MANIFESTS/(ident+'.json'), m)
    # Each legacy wrapper writes a fresh epoch on restart.
    for r in saved['rules']:
        if r['state']=='running':
            manager('start', 'firefly-forward-'+r['id'])
    if (ROOT/'state.json').exists():
        state = read(ROOT/'state.json')
        state['mode'] = 'legacy'
        write(ROOT/'state.json', state)
    print('已恢复原独立进程部署。')


def apply(payload):
    state = read(ROOT/'state.json')
    if state['owner'] != payload['owner'] or state.get('mode')!='shared':
        raise RuntimeError('共享引擎状态不一致，请重新切换或回退')
    if payload['action']=='status' and not manager('status'):
        print('FIREFLY_FORWARD_STOPPED')
        return
    if not manager('status'):
        manager('start')
    state = wait_ready()
    old = copy.deepcopy(state)
    ident, action = payload['id'], payload['action']
    existing = state['rules'].get(ident)
    rule = next((r for r in payload['rules'] if r['id']==payload.get('replacement_id', ident)), None)
    if action=='status':
        present = {r['name'] for r in api(state, '').get('data', {}).get('list', [])}
        print('FIREFLY_FORWARD_ACTIVE' if existing and existing['active'] and set(service_names(existing)) <= present else 'FIREFLY_FORWARD_STOPPED')
        return
    if existing and existing['active']:
        snapshot(existing, MANIFESTS/(ident+'.json'))
    if action=='resume' and existing and existing['active']:
        present = {r['name'] for r in api(state, '').get('data', {}).get('list', [])}
        if set(service_names(existing)) <= present:
            print('规则已在共享进程运行，无需重启其他规则。\nFIREFLY_FORWARD_ACTIVE')
            return
    try:
        if existing and existing['active']:
            delete_services(state, existing)
        if action in ('remove', 'edit'):
            state['rules'].pop(ident, None)
        if action=='stop' and existing:
            existing['active'] = False
        if action in ('start', 'resume', 'edit'):
            entry = {**rule, 'generation': str(uuid.uuid4()), 'active': True}
            state['rules'][entry['id']] = entry
            add_services(state, entry)
        persist(state)
        if action in ('remove', 'edit'):
            (MANIFESTS/(ident+'.json')).unlink(missing_ok=True)
        if action=='remove' and not state['rules']:
            manager('stop')
            (ROOT/'state.json').unlink(missing_ok=True)
            (ROOT/'config.json').unlink(missing_ok=True)
            print('FIREFLY_ENGINE_EMPTY')
        print('FIREFLY_FORWARD_REMOVED' if action=='remove' else 'FIREFLY_FORWARD_STOPPED' if action=='stop' else 'FIREFLY_FORWARD_ACTIVE')
    except Exception:
        for r in state['rules'].values():
            if r['id'] not in old['rules'] or r.get('generation')!=old['rules'][r['id']].get('generation'):
                delete_services(state, r)
                (MANIFESTS/(r['id']+'.json')).unlink(missing_ok=True)
        if existing and old['rules'][ident]['active']:
            # A new generation avoids reusing the retained Prometheus counters.
            restored = old['rules'][ident]
            delete_services(state, restored)
            restored['generation'] = str(uuid.uuid4())
            add_services(old, restored)
        persist(old)
        print('单条规则操作失败，已恢复原配置；其他规则未重启。')
        raise


def rollback(payload):
    if not (ROOT/'state.json').exists():
        print('远端尚未启用共享引擎，保留原独立进程。')
        return
    state = read(ROOT/'state.json')
    if state['owner']!=payload['owner']:
        raise RuntimeError('共享引擎属于其他节点')
    if state['mode']=='migrating' and (ROOT/'migration.json').exists():
        recover_legacy(read(ROOT/'migration.json'))
        (ROOT/'migration.json').unlink()
        return
    if state['mode']!='shared':
        if state['mode']=='legacy':
            print('远端已是独立进程模式。')
            return
        raise RuntimeError('远端不是共享模式，请检查状态')
    if not manager('status'):
        manager('start')
    state = wait_ready()
    for r in state['rules'].values():
        if r['active']:
            snapshot(r, MANIFESTS/(r['id']+'.json'))
    manager('stop')
    started = []
    try:
        for item in payload['legacy']:
            print('恢复独立规则 '+item['id'][:8], flush=True)
            result = subprocess.run(['sh', '-s'], input=item['script'], text=True, env={**os.environ, 'FIREFLY_ENGINE_INTERNAL': '1'}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
            started.append(item['id'])
            if result.returncode:
                print(getattr(result, 'stdout', '')[-2048:], flush=True)
                raise RuntimeError('独立进程恢复失败')
        state['mode'] = 'legacy'
        write(ROOT/'state.json', state)
        known = {r['id'] for r in payload['rules'] if r.get('installed')}
        for ident in set(state['rules'])-known:
            (MANIFESTS/(ident+'.json')).unlink(missing_ok=True)
        print('已回退独立进程，保留规则标识和主控历史。')
    except Exception:
        for ident in started:
            manager('stop', 'firefly-forward-'+ident)
        persist(state)
        manager('start')
        wait_ready()
        print('回退失败，已恢复共享引擎。')
        raise


def execute(payload):
    if payload['action']=='migrate':
        migrate(payload)
        print('FIREFLY_ENGINE_SHARED')
    elif payload['action']=='rollback':
        rollback(payload)
        print('FIREFLY_ENGINE_LEGACY')
    else:
        if payload.get('ensure_shared'):
            print('正在准备统一转发服务；旧实例将自动合并，已有连接可能短暂中断。', flush=True)
            migrate(payload)
            print('FIREFLY_ENGINE_SHARED', flush=True)
        apply(payload)


def main(payload):
    validate(payload)
    ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
    MANIFESTS.mkdir(mode=0o700, parents=True, exist_ok=True)
    import fcntl
    with open(ROOT/'lock', 'w') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        execute(payload)


if __name__=='__main__':
    try:
        if len(sys.argv)>1 and sys.argv[1]=='boot':
            boot()
        else:
            main(json.load(sys.stdin))
    except Exception as exc:
        # Exceptions may include API credentials/URLs: emit fixed categories only.
        print('共享引擎操作失败：'+(str(exc) if isinstance(exc, RuntimeError) else type(exc).__name__), file=sys.stderr)
        sys.exit(1)
