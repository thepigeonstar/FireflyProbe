import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const sh=process.platform==='win32'?'D:/Program Files/Git/bin/sh.exe':'sh';
const shellPath=p=>p.replaceAll('\\','/').replace(/^([A-Z]):\//i,(_,d)=>'/'+d.toLowerCase()+'/');
const source=name=>readFileSync(new URL('../'+name,import.meta.url),'utf8');
const extract=s=>s.slice(s.indexOf('firefly_apt_install() ('),s.indexOf('\n)\n',s.indexOf('firefly_apt_install() ('))+3);
const fn=extract(source('agent/entry.sh'));
const required='DPkg::Pre-Install-Pkgs::required "/fixture/required-check";';
const hook='DPkg::Pre-Install-Pkgs:: "/usr/bin/apt-listchanges --apt || test $? -lt 10";';
const original=['DPkg "";','DPkg::Pre-Install-Pkgs "";',hook,required,'DPkg::Pre-Invoke:: "/fixture/pre-invoke";','DPkg::Tools::Options::/usr/bin/apt-listchanges::Version "2";'].join('\n')+'\n';
function run(dump=original,status=0,dumpStatus=0,shell=sh){
 const dir=mkdtempSync(join(tmpdir(),'firefly-apt-')),input=join(dir,'original');writeFileSync(input,dump);
 const script=`set -eu
if [ -n "${'${BASH_VERSION:-}'}" ]; then set -E; trap 'echo ROLLBACK_REQUIRED >&2' ERR; fi
export APT_LISTCHANGES_FRONTEND=pager
apt-config(){ cat "$FIXTURE_INPUT"; return "$FIXTURE_DUMP_STATUS"; }
apt-get(){
  [ "$1" = -c ] || return 97
  cp "$2" "$FIXTURE_RESULT"
  shift 2
  [ "$DEBIAN_FRONTEND" = noninteractive ] && [ "$APT_LISTCHANGES_FRONTEND" = none ] || return 98
  [ "$*" = 'install -y --no-upgrade vnstat python3 ca-certificates iproute2 tzdata' ] || return 96
  # The crashing hook ignores the frontend variable: it must never be invoked.
  if grep -q apt-listchanges "$FIXTURE_RESULT"; then return 139; fi
  printf 'APT_CALLED\\n'
  return "$FIXTURE_APT_STATUS"
}
${fn}
firefly_apt_install vnstat python3 ca-certificates iproute2 tzdata
printf 'parent:%s' "$APT_LISTCHANGES_FRONTEND"
`;
 try{
  const result=spawnSync(shell,['-c',script],{encoding:'utf8',env:{...process.env,TMPDIR:shellPath(dir),FIXTURE_INPUT:shellPath(input),FIXTURE_RESULT:shellPath(join(dir,'result')),FIXTURE_APT_STATUS:String(status),FIXTURE_DUMP_STATUS:String(dumpStatus)}});
  const files=readdirSync(dir);return {...result,config:files.includes('result')?readFileSync(join(dir,'result'),'utf8'):null,files,original:readFileSync(input,'utf8')};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
test('两安装入口和独立修复脚本使用同一临时APT钩子过滤，调用缺失依赖安装',()=>{
 assert.ok(fn.startsWith('firefly_apt_install() ('));
 assert.equal(extract(source('agent/install.sh')),fn);
 assert.equal(extract(source('tools/install-agent-deps.sh')),fn);
 assert.match(source('agent/install.sh'),/firefly_apt_install vnstat python3 ca-certificates iproute2 tzdata/);
 assert.match(source('agent/entry.sh'),/firefly_apt_install bash curl ca-certificates python3/);
});
test('崩溃钩子不因none而恢复：仅排除标准调用，逐字保留其他钩子，不改系统配置',()=>{
 const r=run();assert.equal(r.status,0,r.stderr);assert.equal(r.config,'#clear DPkg::Pre-Install-Pkgs;\nDPkg::Pre-Install-Pkgs "";\n'+required+'\n');
 assert.equal(r.original,original);assert.match(r.stdout,/APT_CALLED/);assert.match(r.stdout,/parent:pager$/);assert.deepEqual(r.files.sort(),['original','result']);
 const plain=run(original.replace(hook,'DPkg::Pre-Install-Pkgs:: "/usr/bin/apt-listchanges --apt";'));assert.equal(plain.status,0,plain.stderr);
});
test('安装真实错误100与配置读取错误保留，清理临时文件且不继续',()=>{
 const r=run(original,100);assert.equal(r.status,100,r.stderr);assert.doesNotMatch(r.stdout,/parent:/);assert.deepEqual(r.files.sort(),['original','result']);
 const failedDump=run(original,0,100);assert.equal(failedDump.status,100);assert.equal(failedDump.config,null);assert.deepEqual(failedDump.files,['original']);
 const bash=process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash';
 const rollback=run(original,100,0,bash);assert.equal(rollback.status,100,rollback.stderr);assert.equal((rollback.stderr.match(/ROLLBACK_REQUIRED/g)||[]).length,1,rollback.stderr);
});
test('没有变更说明钩子时保留列表；自定义复合钩子和apt-get专用覆盖拒绝自动处理',()=>{
 const absent=run(original.replace(hook+'\n',''));assert.equal(absent.status,0,absent.stderr);assert.match(absent.config,/required-check/);
 for(const line of ['DPkg::Pre-Install-Pkgs:: "/fixture/check && /usr/bin/apt-listchanges --apt";','Binary::apt-get::DPkg::Pre-Install-Pkgs:: "/fixture/private-check";']){
  const r=run(original+'\n'+line+'\n');assert.equal(r.status,42,r.stderr);assert.equal(r.config,null);assert.doesNotMatch(r.stdout,/APT_CALLED/);assert.match(r.stderr,/手动核对/);assert.deepEqual(r.files,['original']);
 }
});
