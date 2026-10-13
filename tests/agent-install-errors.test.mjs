import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const bash=process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash';
test('安装入口覆盖远端 Latin-1 Python 输出配置',()=>{
  for(const file of ['entry.sh','bootstrap.sh','install.sh']){
    const source=readFileSync(new URL('../agent/'+file,import.meta.url),'utf8');
    const setup=source.slice(0,source.indexOf('umask 077'));
    const run=spawnSync(bash,['-c',setup+'\nprintf "%s/%s" "$PYTHONUTF8" "$PYTHONIOENCODING"'],{encoding:'utf8',env:{...process.env,PYTHONUTF8:'0',PYTHONIOENCODING:'latin-1'}});
    assert.equal(run.status,0,run.stderr);
    assert.equal(run.stdout,'1/utf-8');
  }
});
test('Debian 11 软件源失败保留退出码并提示退役源，不继续安装',()=>{
  const source=readFileSync(new URL('../agent/install.sh',import.meta.url),'utf8');
  const block=source.slice(source.indexOf('  if apt-get update; then'),source.indexOf('  DEBIAN_FRONTEND=noninteractive apt-get install'));
  const run=spawnSync(bash,['-c','set -e\nID=debian; VERSION_ID=11\napt-get(){ return 100; }\n'+block+'\necho SHOULD_NOT_CONTINUE'],{encoding:'utf8'});
  assert.equal(run.status,100);
  assert.ok(run.stderr.includes('bullseye-backports'));
  assert.ok(!run.stdout.includes('SHOULD_NOT_CONTINUE'));
});
