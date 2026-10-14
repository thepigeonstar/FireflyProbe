import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import {spawnSync} from 'node:child_process';
test('时区迁移提示在 C 与 UTF-8 locale 下不误解析相邻中文为变量名',()=>{
 const source=readFileSync(new URL('../agent/install.sh',import.meta.url),'utf8'),message=/echo "vnStat 统计时区将改为[^\n]+/.exec(source)[0];
 for(const locale of ['C','C.UTF-8']){const run=spawnSync(process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash',['-c','set -eu\nzone=Asia/Shanghai\nhistory_start=2026-10-15\n'+message],{encoding:'utf8',env:{...process.env,LC_ALL:locale}});assert.equal(run.status,0,run.stderr);assert.ok(run.stdout.includes('Asia/Shanghai（'));assert.ok(run.stdout.includes('2026-10-15'));}
});
