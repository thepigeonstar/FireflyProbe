"""Runs against the official GOST binary; no root/systemd/production host required."""
import contextlib
import importlib.util
import io
import json
import pathlib
import socket
import subprocess
import sys
import tempfile
import threading
import time
import uuid
from types import SimpleNamespace
from unittest.mock import patch

source=pathlib.Path(__file__).resolve().parents[1]/'tools'/'forward-engine.py'
spec=importlib.util.spec_from_file_location('engine',source)
engine=importlib.util.module_from_spec(spec);spec.loader.exec_module(engine)
binary=str(pathlib.Path(sys.argv[1]).resolve())
tcp=socket.socket();tcp.bind(('127.0.0.1',0));tcp.listen();target=tcp.getsockname()[1]
udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);udp.bind(('127.0.0.1',target))
def echo_conn(conn):
    try:
        with conn:
            while True:
                raw=conn.recv(65536)
                if not raw:return
                conn.sendall(raw)
    except OSError:pass
def tcp_server():
    while True:
        try:conn,_=tcp.accept()
        except OSError:return
        threading.Thread(target=echo_conn,args=(conn,),daemon=True).start()
def udp_server():
    while True:
        try:raw,addr=udp.recvfrom(65536);udp.sendto(raw,addr)
        except OSError:return
threading.Thread(target=tcp_server,daemon=True).start();threading.Thread(target=udp_server,daemon=True).start()
def port():
    with socket.socket() as sock:sock.bind(('127.0.0.1',0));return sock.getsockname()[1]
processes={};logs=[]
with tempfile.TemporaryDirectory() as directory:
    root=pathlib.Path(directory);engine.ROOT=root/'engine';engine.MANIFESTS=root/'manifests';engine.BACKUPS=root/'backups';engine.ROOT.mkdir();engine.MANIFESTS.mkdir()
    rules=[dict(id=str(uuid.uuid4()),protocol=p,listen_port=port(),target_host='127.0.0.1',target_port=target,installed=True,state='stopped' if i==2 else 'running') for i,p in enumerate(['tcp','both','udp'])]
    by_id={r['id']:r for r in rules};owner=str(uuid.uuid4())
    def manager(action,unit=engine.UNIT):
        process=processes.get(unit)
        if action=='status':return process is not None and process.poll() is None
        if action=='stop':
            if process and process.poll() is None:
                process.terminate()
                try:process.wait(timeout=5)
                except subprocess.TimeoutExpired:process.kill();process.wait()
            return
        if process and process.poll() is None:return
        log=tempfile.TemporaryFile();logs.append(log)
        if unit==engine.UNIT:
            state=engine.read(engine.ROOT/'state.json');state['process_epoch']=str(uuid.uuid4());engine.persist(state)
            args=[binary,'-C',str(engine.ROOT/'config.json')]
        else:
            rule=by_id[unit.removeprefix('firefly-forward-')];metrics=port()
            engine.write(engine.MANIFESTS/(rule['id']+'.json'),dict(id=rule['id'],epoch=str(uuid.uuid4()),port=metrics))
            args=[binary]
            for kind in (['tcp','udp'] if rule['protocol']=='both' else [rule['protocol']]):args+=['-L',f'{kind}://127.0.0.1:{rule["listen_port"]}/127.0.0.1:{target}']
            args+=['-metrics',f'127.0.0.1:{metrics}']
        processes[unit]=subprocess.Popen(args,stdout=log,stderr=log)
        if unit!=engine.UNIT:
            for _ in range(50):
                try:engine.http(metrics,'/metrics');break
                except OSError:time.sleep(.1)
            else:raise RuntimeError('legacy metrics did not start')
    def probe(rule,size=32):
        raw=b'x'*size
        for _ in range(50):
            try:
                with socket.create_connection(('127.0.0.1',rule['listen_port']),timeout=1) as conn:
                    conn.sendall(raw);value=b''
                    while len(value)<size:
                        piece=conn.recv(size-len(value))
                        if not piece:raise ConnectionError('unexpected EOF')
                        value+=piece
                    assert value==raw
                return
            except OSError:time.sleep(.1)
        raise RuntimeError('TCP forwarding not ready')
    payload=lambda action,**extra:dict(owner=owner,rules=list(by_id.values()),action=action,**extra)
    try:
        with patch.object(engine,'manager',side_effect=manager),patch.object(engine,'install_unit'):
            for r in rules:
                manager('start','firefly-forward-'+r['id'])
                if r['state']=='stopped':manager('stop','firefly-forward-'+r['id'])
            probe(rules[0]);probe(rules[1]);engine.migrate(payload('migrate'))
            assert sum(p.poll() is None for p in processes.values())==1
            state=engine.read(engine.ROOT/'state.json');pid=processes[engine.UNIT].pid
            probe(rules[0],100);probe(rules[1],1000)
            with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as conn:
                conn.settimeout(5);conn.sendto(b'udp-check',('127.0.0.1',rules[1]['listen_port']));assert conn.recvfrom(4096)[0]==b'udp-check'
            a=engine.snapshot(rules[0],engine.MANIFESTS/(rules[0]['id']+'.json'));b=engine.snapshot(rules[1],engine.MANIFESTS/(rules[1]['id']+'.json'));assert 0<a['rx']<b['rx'];assert 0<a['tx']<b['tx']
            with socket.create_connection(('127.0.0.1',rules[1]['listen_port']),timeout=2) as ongoing:
                engine.apply(payload('stop',id=rules[0]['id']));ongoing.sendall(b'still-alive');assert ongoing.recv(4096)==b'still-alive';assert processes[engine.UNIT].pid==pid
                engine.apply(payload('resume',id=rules[0]['id']));probe(rules[0])
                original=rules[0];replacement={**original,'id':str(uuid.uuid4())};by_id[replacement['id']]=replacement
                engine.apply(payload('edit',id=original['id'],replacement_id=replacement['id']));by_id.pop(original['id']);probe(replacement)
                # Binding an occupied port must roll back this service only.
                bad={**replacement,'id':str(uuid.uuid4()),'listen_port':rules[1]['listen_port']};by_id[bad['id']]=bad
                try:engine.apply(payload('edit',id=replacement['id'],replacement_id=bad['id']))
                except Exception:pass
                else:raise AssertionError('occupied port unexpectedly accepted')
                by_id.pop(bad['id']);probe(replacement);ongoing.sendall(b'unaffected');assert ongoing.recv(4096)==b'unaffected';assert processes[engine.UNIT].pid==pid
            real_run=subprocess.run
            def legacy_run(command,**kwargs):
                if command==['sh','-s'] and kwargs.get('input','').startswith('restore:'):
                    ident=kwargs['input'].split(':',1)[1];manager('start','firefly-forward-'+ident)
                    if by_id[ident]['state']=='stopped':manager('stop','firefly-forward-'+ident)
                    return SimpleNamespace(returncode=0)
                return real_run(command,**kwargs)
            with patch.object(engine.subprocess,'run',side_effect=legacy_run):engine.rollback(payload('rollback',legacy=[dict(id=r['id'],script='restore:'+r['id']) for r in by_id.values()]))
            assert not manager('status');assert engine.read(engine.ROOT/'state.json')['mode']=='legacy';probe(replacement);probe(rules[1]);assert sum(p.poll() is None for p in processes.values())==2
            print('Real GOST shared engine: migration, one process, TCP/UDP, service counters, stop/resume/edit isolation, occupied-port rollback and legacy return passed.')
    except Exception:
        for log in logs:
            log.seek(0);print(log.read().decode(errors='replace'),file=sys.stderr)
        raise
    finally:
        for unit in processes:manager('stop',unit)
        for log in logs:log.close()
tcp.close();udp.close()
