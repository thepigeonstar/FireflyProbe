#!/usr/bin/env bash
set -euo pipefail
temporary=$(mktemp -d)
trap 'rm -rf -- "$temporary"' EXIT
echo 'Downloading official GOST 3.3.0 Linux amd64 archive...'
curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --connect-timeout 15 --max-time 300 https://github.com/go-gost/gost/releases/download/v3.3.0/gost_3.3.0_linux_amd64.tar.gz -o "$temporary/gost.tar.gz"
printf '%s  %s\n' 676fb7f78d267b6ae73df719c0c7f2b565dde7147da935cfafbc1e1da558b6d5 "$temporary/gost.tar.gz" | sha256sum -c -
tar -xzf "$temporary/gost.tar.gz" -C "$temporary" gost
echo 'Testing real TCP and UDP loopback forwarding...'
python3 - "$temporary/gost" <<'PY'
import socket, subprocess, sys, threading, time, tempfile, urllib.request
tcp=socket.socket(); tcp.bind(('127.0.0.1',0)); tcp.listen(); target=tcp.getsockname()[1]
udp=socket.socket(socket.AF_INET,socket.SOCK_DGRAM); udp.bind(('127.0.0.1',target))
reserve=socket.socket(); reserve.bind(('127.0.0.1',0)); listen=reserve.getsockname()[1]; reserve.close()
reserve=socket.socket(); reserve.bind(('127.0.0.1',0)); metrics=reserve.getsockname()[1]; reserve.close()
def echo_tcp():
    while True:
        c,_=tcp.accept()
        with c:
            while True:
                data=c.recv(4096)
                if not data: break
                c.sendall(data)
def echo_udp():
    while True:
        data,address=udp.recvfrom(4096); udp.sendto(data,address)
threading.Thread(target=echo_tcp,daemon=True).start()
threading.Thread(target=echo_udp,daemon=True).start()
logs=tempfile.TemporaryFile()
p=subprocess.Popen([sys.argv[1],'-L',f'tcp://127.0.0.1:{listen}/127.0.0.1:{target}','-L',f'udp://127.0.0.1:{listen}/127.0.0.1:{target}','-metrics',f'127.0.0.1:{metrics}'],stdout=logs,stderr=logs)
try:
    for attempt in range(50):
        if p.poll() is not None: raise RuntimeError('GOST exited')
        try:
            with socket.create_connection(('127.0.0.1',listen),timeout=1) as c:
                c.sendall(b'firefly-tcp'); assert c.recv(4096)==b'firefly-tcp'
            break
        except (ConnectionError,TimeoutError): time.sleep(.1)
    else: raise RuntimeError('TCP forwarding did not start')
    with socket.socket(socket.AF_INET,socket.SOCK_DGRAM) as c:
        c.settimeout(5); c.sendto(b'firefly-udp',('127.0.0.1',listen)); assert c.recvfrom(4096)[0]==b'firefly-udp'
    with urllib.request.urlopen(f'http://127.0.0.1:{metrics}/metrics',timeout=5) as r: values=r.read().decode()
    assert 'gost_services' in values
    for name in ['gost_service_transfer_input_bytes_total','gost_service_transfer_output_bytes_total']:
        total=sum(float(line.rsplit(' ',1)[1]) for line in values.splitlines() if line.startswith(name+'{'))
        assert total>0, 'GOST byte counter missing: '+name
    print('Official GOST 3.3.0 TCP, UDP and Metrics byte counters passed')
except Exception:
    logs.seek(0)
    print('GOST process output:',file=sys.stderr)
    print(logs.read().decode('utf-8',errors='replace'),file=sys.stderr)
    raise
finally:
    p.terminate()
    try: p.wait(timeout=5)
    except subprocess.TimeoutExpired: p.kill(); p.wait()
    logs.close()
    tcp.close(); udp.close()
PY

python3 -B tests/forward-engine-real.test.py "$temporary/gost"
