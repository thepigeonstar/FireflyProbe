import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const sh=process.platform==='win32'?'D:/Program Files/Git/bin/sh.exe':'sh';
const shellPath=p=>p.replaceAll('\\','/').replace(/^([A-Z]):\//i,(_,drive)=>'/'+drive.toLowerCase()+'/');
test('Alpine 默认 sh 入口准备 Bash/curl/Python，下载正确脚本并安全传递参数',()=>{
 const dir=mkdtempSync(join(tmpdir(),'entry-alpine-')),mock=join(dir,'mock'),trace=join(dir,'trace'),release=join(dir,'os-release'),entry=join(dir,'entry.sh');mkdirSync(mock);writeFileSync(release,'ID=alpine\nVERSION_ID=3.22.0\n');
 const original=readFileSync(new URL('../agent/entry.sh',import.meta.url),'utf8');writeFileSync(entry,original.replace(/^\[ "\$\(id -u\)".*$/m,'# Root check bypassed only in an isolated fixture.').replaceAll('/etc/os-release','"$TEST_RELEASE"'));
 writeFileSync(join(mock,'apk'),'#!/bin/sh\nif [ "$1" = version ]; then echo ">"; else printf "%s\\n" "$*" >> "$TEST_TRACE"; fi\n',{mode:0o755});
 writeFileSync(join(mock,'curl'),'#!/bin/sh\nwhile [ "$#" -gt 0 ]; do if [ "$1" = -o ]; then shift; output=$1; elif [ "${1#https://}" != "$1" ]; then printf "%s\\n" "$1" >> "$TEST_TRACE"; fi; shift; done\nprintf "#!/bin/sh\\nexit 0\\n" > "$output"\n',{mode:0o755});
 writeFileSync(join(mock,'bash'),'#!/bin/sh\nprintf "%s\\n" "$*" > "$TEST_ARGUMENTS"\n',{mode:0o755});
 try{const argumentsFile=join(dir,'arguments'),secret='a'.repeat(64),command='PATH="$1:$PATH"; export PATH; sh "$2" --server https://monitor.example.com --token "$3"',result=spawnSync(sh,['-c',command,'fixture',shellPath(mock),shellPath(entry),secret],{encoding:'utf8',env:{...process.env,TEST_RELEASE:shellPath(release),TEST_TRACE:shellPath(trace),TEST_ARGUMENTS:shellPath(argumentsFile)}});assert.equal(result.status,0,result.stderr);assert.ok(readFileSync(trace,'utf8').includes('add --no-cache bash curl ca-certificates python3'));assert.ok(readFileSync(trace,'utf8').includes('https://monitor.example.com/downloads/bootstrap.sh'));assert.ok(readFileSync(argumentsFile,'utf8').includes('--token '+secret));assert.ok(!(result.stdout+result.stderr).includes(secret));}
 finally{rmSync(dir,{recursive:true,force:true});}
});
