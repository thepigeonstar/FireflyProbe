#!/usr/bin/env python3
"""Read-only paired snapshots. Never read the agent token or change services."""
import concurrent.futures
import datetime
import decimal
import glob
import json
import os
import re
import time
import urllib.request

METRICS = {
    'gost_service_transfer_input_bytes_total': 'rx',
    'gost_service_transfer_output_bytes_total': 'tx',
    'gost_service_handler_errors_total': 'errors',
}
SAMPLE = re.compile(r'^(gost_service_transfer_input_bytes_total|gost_service_transfer_output_bytes_total|gost_service_handler_errors_total)(?:\{.*\})?\s+(\S+)(?:\s+\d+)?$')
UUID = re.compile(r'^[a-f0-9-]{36}$')
LIMIT = 2 * 1024 * 1024


def parse_metrics(text):
    totals = dict(rx=0, tx=0, errors=0)
    legacy = dict(rx=0, tx=0, errors=0)
    seen = False
    for line in text.splitlines():
        match = SAMPLE.fullmatch(line)
        if not match:
            continue
        try:
            value = decimal.Decimal(match.group(2))
            if not value.is_finite() or value < 0 or value > 8e15:
                continue
        except decimal.InvalidOperation:
            continue
        key = METRICS[match.group(1)]
        totals[key] += int(value)
        seen = seen or key in ('rx', 'tx')
        # Match the current agent's two-field parser for comparison.
        fields = line.split()
        if len(fields) == 2:
            legacy[key] += int(value)
    return totals, legacy, seen


def network():
    result = {}
    with open('/proc/net/dev', encoding='ascii') as stream:
        for line in stream:
            if ':' not in line:
                continue
            name, values = line.rsplit(':', 1)
            fields = values.split()
            if len(fields) >= 16:
                result[name.strip()] = {'rx': int(fields[0]), 'tx': int(fields[8])}
    return result


def tcp_stats():
    try:
        with open('/proc/net/snmp', encoding='ascii') as stream:
            rows = [line.split()[1:] for line in stream if line.startswith('Tcp:')]
        return dict(zip(rows[0], map(int, rows[1])))
    except (OSError, ValueError, IndexError):
        return {}


def collect(path):
    result = {'file': os.path.basename(path), 'ok': False}
    try:
        with open(path, encoding='utf-8') as stream:
            manifest = json.load(stream)
        if not UUID.fullmatch(manifest.get('id', '')) or not UUID.fullmatch(manifest.get('epoch', '')):
            raise ValueError('manifest')
        port = manifest.get('port')
        if type(port) is not int or not 1 <= port <= 65535:
            raise ValueError('port')
        result.update(id=manifest['id'], epoch=manifest['epoch'], port=port)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
        with opener.open('http://127.0.0.1:%d/metrics' % port, timeout=2) as response:
            raw = response.read(LIMIT + 1)
        result['size'] = len(raw)
        if len(raw) > LIMIT:
            result['error'] = 'Metrics 超过 2 MiB 诊断读取上限'
            return result
        totals, legacy, seen = parse_metrics(raw.decode('utf-8', errors='replace'))
        with open(path, encoding='utf-8') as stream:
            after = json.load(stream)
        if (after.get('epoch'), after.get('port')) != (manifest['epoch'], port):
            result['error'] = '采样期间服务重启，不能配对'
            return result
        result.update(ok=seen, totals=totals, legacy=legacy, agent_limit=len(raw) > 262144,
                      parser_gap=totals != legacy, agent_marker=b'gost_services' in raw)
        if not seen:
            result['error'] = '无字节计数（新规则尚无流量时也可能出现）'
    except Exception as exc:
        # Do not print raw file contents, URLs or exception messages.
        result['error'] = type(exc).__name__
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def snapshot():
    before, tcp = network(), tcp_stats()
    paths = sorted(glob.glob('/etc/firefly-forward/*.json'))
    if len(paths) > 200:
        raise RuntimeError('规则超过 200 条，请检查配置')
    pool = concurrent.futures.ThreadPoolExecutor(max_workers=4)
    futures = {pool.submit(collect, path): path for path in paths}
    done, pending = concurrent.futures.wait(futures, timeout=6)
    samples = {os.path.basename(futures[f]): f.result() for f in done}
    for future in pending:
        future.cancel()
        name = os.path.basename(futures[future])
        samples[name] = {'file': name, 'ok': False, 'error': '全局采样超时'}
    pool.shutdown(wait=False, cancel_futures=True)
    return {'before': before, 'after': network(), 'tcp': tcp, 'samples': samples,
            'time': datetime.datetime.now(datetime.timezone.utc).isoformat()}


def process_summary():
    count, ages = 0, []
    try:
        uptime = float(open('/proc/uptime', encoding='ascii').read().split()[0])
        ticks = os.sysconf('SC_CLK_TCK')
        for path in glob.glob('/proc/[0-9]*/cmdline'):
            try:
                command = open(path, 'rb').read(65536).split(b'\0')[0]
                if not command.startswith(b'/opt/firefly-forward/gost-'):
                    continue
                stat = open(path[:-7] + 'stat', encoding='utf-8').read()
                start = int(stat[stat.rfind(')') + 2:].split()[19]) / ticks
                count += 1
                ages.append(max(0, int(uptime - start)))
            except (OSError, ValueError, IndexError):
                continue
    except (OSError, ValueError):
        pass
    return count, min(ages) if ages else None


def amount(value):
    return '%.3f MiB (%d B)' % (value / 1048576, value)


def compare(first, second, interface, expected_rule_ids=None):
    rx = tx = errors = valid = invalid = 0
    expected = set(expected_rule_ids or [])
    matched_rx = matched_tx = 0
    samples_a, samples_b = first['samples'], second['samples']
    names = sorted(set(samples_a) | set(samples_b))
    for index, name in enumerate(names):
        a, b = samples_a.get(name, {}), samples_b.get(name, {})
        reason = ''
        if not a.get('ok') or not b.get('ok'):
            reason = a.get('error') or b.get('error') or '采样期间规则出现或消失'
        elif (a['id'], a['epoch'], a['port']) != (b['id'], b['epoch'], b['port']):
            reason = '统计标识改变，疑似重启'
        elif any(b['totals'][k] < a['totals'][k] for k in ['rx', 'tx', 'errors']):
            reason = '同进程累计计数回退'
        if reason:
            invalid += 1
            if index < 30:
                print('规则 %s：不可配对 · %s' % (name[:8], reason), flush=True)
            continue
        delta = {k: b['totals'][k] - a['totals'][k] for k in ['rx', 'tx', 'errors']}
        valid += 1
        rx += delta['rx']; tx += delta['tx']; errors += delta['errors']
        if a['id'] in expected:
            matched_rx += delta['rx']; matched_tx += delta['tx']
        flags = []
        if a.get('agent_limit') or b.get('agent_limit'):
            flags.append('超过采集端 256 KiB 上限')
        if a.get('parser_gap') or b.get('parser_gap'):
            flags.append('原始计数与现有采集解析不同')
        if not a.get('agent_marker') or not b.get('agent_marker'):
            flags.append('缺少采集端要求的服务标记')
        if index < 30:
            print('规则 %s：接收 %s · 发送 %s%s' % (name[:8], amount(delta['rx']), amount(delta['tx']),
                  (' · 注意：' + '；'.join(flags)) if flags else ''), flush=True)
    print('有效配对 %d / %d；不可配对 %d' % (valid, len(names), invalid), flush=True)
    print('GOST 原始增量：接收 %s；发送 %s；合计 %s；新增处理错误 %d' %
          (amount(rx), amount(tx), amount(rx + tx), errors), flush=True)
    if expected:
        actual = {s.get('id') for s in samples_b.values() if s.get('id')}
        extra, missing = sorted(actual - expected), sorted(expected - actual)
        print('本主控关联规则原始增量：接收 %s；发送 %s；合计 %s' %
              (amount(matched_rx), amount(matched_tx), amount(matched_rx + matched_tx)), flush=True)
        print('主控关联 %d 条；远端可识别清单 %d 条；额外清单 %d 条；未见清单 %d 条' %
              (len(expected), len(actual), len(extra), len(missing)), flush=True)
        if extra:
            print('额外清单（可能是遗留规则或其他节点）：' + ', '.join(x[:8] for x in extra[:30]), flush=True)
        if missing:
            print('未见清单（未安装规则也会出现）：' + ', '.join(x[:8] for x in missing[:30]), flush=True)
    available = sorted(set(first['after']) & set(second['before']))
    if interface:
        available = [interface] if interface in available else []
        if not available:
            print('指定统计网卡不存在，本轮不能比较网卡数据。', flush=True)
    else:
        available = [n for n in available if n != 'lo']
        print('未指定网卡：逐网卡列出，不将虚拟网卡重复相加。', flush=True)
    for name in available:
        if any(second['before'][name][k] < first['after'][name][k] for k in ['rx', 'tx']):
            print('网卡 %s：计数回退，不能比较' % name, flush=True)
            continue
        low = sum(second['before'][name][k] - first['after'][name][k] for k in ['rx', 'tx'])
        high = sum(second['after'][name][k] - first['before'][name][k] for k in ['rx', 'tx'])
        print('网卡 %s 收发增量范围：%s — %s' % (name, amount(low), amount(high)), flush=True)
        if rx + tx and not invalid and interface:
            print('网卡 / GOST 区间比：%.3f — %.3f（同网卡外部中转常见接近 2，不能作为强制校准倍数）' %
                  (low / (rx + tx), high / (rx + tx)), flush=True)
    retrans = second['tcp'].get('RetransSegs', 0) - first['tcp'].get('RetransSegs', 0)
    outgoing = second['tcp'].get('OutSegs', 0) - first['tcp'].get('OutSegs', 0)
    if retrans >= 0 and outgoing >= 0:
        print('系统 TCP 重传段增量 %d；发送段增量 %d（段数不是流量字节）' % (retrans, outgoing), flush=True)
    if invalid or not valid:
        print('存在缺失/重启或无有效规则，本轮无法确认总体流量比例。', flush=True)
    elif rx + tx == 0:
        print('本轮没有 GOST 流量，请在正常使用转发时重测。', flush=True)
    print('本结果只覆盖本次采样，不能还原或证明此前全天的差额。', flush=True)


def main(interface='', seconds=30, expected_rule_ids=None):
    if interface and not re.fullmatch(r'[a-zA-Z0-9_.:@-]{1,40}', interface):
        raise ValueError('interface')
    if not 1 <= seconds <= 60:
        raise ValueError('seconds')
    print('萤火只读转发诊断：不修改配置、不重启服务、不产生测试下载。', flush=True)
    print('请保持正常转发使用；原始计数与网卡将在同一时间段内配对。', flush=True)
    count, age = process_summary()
    print('萤火 GOST 进程 %d；最短进程运行时间 %s 秒' % (count, age if age is not None else '未知'), flush=True)
    first = snapshot()
    print('第一轮完成（UTC %s），等待 %d 秒…' % (first['time'], seconds), flush=True)
    time.sleep(seconds)
    second = snapshot()
    print('第二轮完成（UTC %s）' % second['time'], flush=True)
    compare(first, second, interface, expected_rule_ids)


if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--interface', default='')
    args = parser.parse_args()
    main(args.interface)
