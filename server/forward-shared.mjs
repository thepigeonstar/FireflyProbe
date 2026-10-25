import {readFileSync} from 'node:fs';
const controller=readFileSync(new URL('../tools/forward-engine.py',import.meta.url),'utf8');
export function sharedScript(payload,{version,hashes}){
 const body=Buffer.from(JSON.stringify(payload)).toString('base64'),source=Buffer.from(controller).toString('base64');
 return `#!/bin/sh
set -eu
umask 077
export PYTHONUTF8=1 PYTHONIOENCODING=utf-8
[ "$(id -u)" = 0 ] || { echo '需要 root 或免密 sudo'; exit 1; }
command -v python3 >/dev/null && command -v curl >/dev/null || { echo '请先安装萤火采集端'; exit 1; }
if ! command -v systemctl >/dev/null && [ ! -x /sbin/openrc-run ]; then echo '需要 systemd 或 OpenRC'; exit 1; fi
install -d -m 0755 /opt/firefly-forward
if [ ! -x /opt/firefly-forward/gost-${version} ]; then
 case "$(uname -m)" in x86_64) arch=amd64; expected=${hashes.amd64} ;; aarch64|arm64) arch=arm64; expected=${hashes.arm64} ;; *) echo '不支持的架构'; exit 1 ;; esac
 temporary=$(mktemp -d)
 trap 'rm -rf -- "$temporary"' EXIT
 curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL --retry 3 --connect-timeout 15 --max-time 300 "https://github.com/go-gost/gost/releases/download/v${version}/gost_${version}_linux_$arch.tar.gz" -o "$temporary/gost.tar.gz"
 printf '%s  %s\\n' "$expected" "$temporary/gost.tar.gz" | sha256sum -c -
 tar -xzf "$temporary/gost.tar.gz" -C "$temporary" gost
 install -m 0755 "$temporary/gost" /opt/firefly-forward/gost-${version}
fi
python3 - <<'FIREFLY_ENGINE'
import base64, os
path='/opt/firefly-forward/engine.py'
with open(path+'.new','wb') as f: f.write(base64.b64decode('${source}'))
os.chmod(path+'.new',0o700)
os.replace(path+'.new',path)
scope={'__name__':'firefly_engine'}
exec(compile(base64.b64decode('${source}'),path,'exec'),scope)
import json
try: scope['main'](json.loads(base64.b64decode('${body}')))
except Exception as exc:
 print('共享引擎操作失败：'+(str(exc) if isinstance(exc,RuntimeError) else type(exc).__name__))
 raise SystemExit(1)
FIREFLY_ENGINE
`;
}
export function finalSamples(log){return String(log||'').split(/\r?\n/).filter(line=>line.startsWith('FIREFLY_FINAL ')).map(line=>{try{return JSON.parse(line.slice(14));}catch{return null;}}).filter(Boolean).slice(0,200);}
