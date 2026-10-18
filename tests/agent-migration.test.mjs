import test from 'node:test';import assert from 'node:assert/strict';import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';import {join} from 'node:path';import {tmpdir} from 'node:os';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const installer=readFileSync(new URL('../agent/install.sh',import.meta.url),'utf8'),functions=installer.slice(installer.indexOf("migration_backup=''"),installer.indexOf("phase='初始化'"));
for(const system of ['debian','alpine'])test('采集端迁移失败恢复旧身份和服务，清理半成品：'+system,()=>{
 const dir=mkdtempSync(join(tmpdir(),'firefly-migrate-')),root=dir.replaceAll('\\','/');
 try{
  for(const folder of ['etc/systemd/system','etc/init.d','etc/runlevels/default','opt/lightprobe','opt/firefly-probe'])mkdirSync(join(dir,folder),{recursive:true});
  writeFileSync(join(dir,'etc/lightprobe-agent.json'),'{"server":"https://fixture.test","token":"fixture","history_start":"2026-01-01","disk_path":"/data"}');writeFileSync(join(dir,'opt/lightprobe/agent'),'legacy executable');writeFileSync(join(dir,'etc/systemd/system/lightprobe-agent.service'),'legacy systemd');writeFileSync(join(dir,'etc/init.d/lightprobe-agent'),'legacy openrc');writeFileSync(join(dir,'etc/runlevels/default/lightprobe-agent'),'enabled');
  const source=functions.replaceAll('/etc/',root+'/etc/').replaceAll('/opt/',root+'/opt/').replaceAll('/var/',root+'/var/');
  const script=`set -euo pipefail
ID=${system}
${process.platform==='win32'?`install(){ mkdir -p "${'$'}{@: -1}"; }
chmod(){ :; }
cp(){ command cp "${'$'}{@: -2}"; }
mktemp(){ local pattern="${'$'}{@: -1}"; local result="${'$'}{pattern%XXXXXXXX}fixture"; mkdir -p "$result"; printf '%s\\n' "$result"; }
`:''}
systemctl(){ case "$*" in 'is-active --quiet lightprobe-agent'|'is-enabled --quiet lightprobe-agent') return 0;; 'is-active --quiet firefly-probe-agent'|'is-enabled --quiet firefly-probe-agent') return 1;; *) printf '%s\\n' "$*" >> '${root}/service-operations';; esac; }
rc-service(){ case "$*" in 'lightprobe-agent status') return 0;; 'firefly-probe-agent status') return 1;; *) printf '%s\\n' "$*" >> '${root}/service-operations';; esac; }
rc-update(){ printf '%s\\n' "$*" >> '${root}/service-operations'; }
${source}
prepare_agent_migration
test "$backup_ready" = true
test "$old_active" = true
migration_started=true
printf 'new incomplete config' > '${root}/etc/firefly-probe-agent.json'
printf 'new executable' > '${root}/opt/firefly-probe/agent'
printf 'new unit' > '${root}/etc/systemd/system/firefly-probe-agent.service'
printf 'new openrc' > '${root}/etc/init.d/firefly-probe-agent'
rm -f '${root}/etc/lightprobe-agent.json' '${root}/opt/lightprobe/agent' '${root}/etc/systemd/system/lightprobe-agent.service' '${root}/etc/init.d/lightprobe-agent'
rollback_agent_migration
`;
  const scriptPath=join(dir,'test.sh');writeFileSync(scriptPath,script);const result=spawnSync(process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash',[scriptPath],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(readFileSync(join(dir,'etc/lightprobe-agent.json'),'utf8')).history_start,'2026-01-01');assert.equal(readFileSync(join(dir,'opt/lightprobe/agent'),'utf8'),'legacy executable');assert.equal(existsSync(join(dir,'etc/firefly-probe-agent.json')),false);assert.equal(existsSync(join(dir,'opt/firefly-probe/agent')),false);assert.match(readFileSync(join(dir,'service-operations'),'utf8'),system==='alpine'?/lightprobe-agent restart/:/restart lightprobe-agent/);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('配置迁移保留 history_start、时区和身份，新旧配置冲突拒绝覆盖',t=>{
 const executable=process.platform==='win32'?fileURLToPath(new URL('../../../work/python-diagnostic/runtime/python.exe',import.meta.url)):'python3';if(process.platform==='win32'&&!existsSync(executable)){t.skip('需要本机 Python 3 以执行安装器配置阶段');return;}
 const dir=mkdtempSync(join(tmpdir(),'firefly-config-migration-')),root=dir.replaceAll('\\','/'),start=installer.indexOf('import json, os, sys, urllib.request, subprocess, re'),end=installer.indexOf('\nPY',start),code=installer.slice(start,end).replaceAll('/etc/',root+'/etc/');mkdirSync(join(dir,'etc'));
 try{
  const config={server:'https://fixture.test',token:'fixture-token',disk_path:'/data',vnstat_timezone:'Asia/Shanghai',history_start:'2026-01-01',custom:'preserve'},old=join(dir,'etc/lightprobe-agent.json'),current=join(dir,'etc/firefly-probe-agent.json'),supplied=join(dir,'input.json');writeFileSync(old,JSON.stringify(config));writeFileSync(supplied,JSON.stringify({server:config.server,token:config.token,disk_path:'/data'}));
  const harness=`import urllib.request, subprocess, io, sys, json\nclass Response(io.BytesIO):\n def __enter__(self): return self\n def __exit__(self,*args): self.close()\nurllib.request.urlopen=lambda *args,**kwargs:Response(b'{"interface":"eth0"}')\nsubprocess.run=lambda *args,**kwargs:None\nsys.argv=['fixture',${JSON.stringify(supplied)},'Asia/Shanghai','2026-10-18']\n${code}`;
  let result=spawnSync(executable,['-B','-c',harness],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(readFileSync(current,'utf8')),config);
  writeFileSync(current,JSON.stringify({...config,token:'other-node'}));const before=readFileSync(current,'utf8');result=spawnSync(executable,['-B','-c',harness],{encoding:'utf8',env:{...process.env,PYTHONIOENCODING:'utf-8'}});assert.notEqual(result.status,0);assert.match(result.stderr,/不同节点/);assert.equal(readFileSync(current,'utf8'),before);assert.equal(JSON.parse(readFileSync(old,'utf8')).token,config.token);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
