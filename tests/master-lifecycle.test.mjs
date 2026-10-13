import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdtempSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const bash=process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash';
const pathForShell=p=>p.replaceAll('\\','/').replace(/^([A-Z]):\//i,(_,drive)=>'/'+drive.toLowerCase()+'/');
test('默认新目录，兼容旧目录；显式目录和已有新目录优先',()=>{
 const dir=mkdtempSync(join(tmpdir(),'install-target-')),preferred=join(dir,'FireflyProbe'),legacy=join(dir,'lightprobe');mkdirSync(preferred);mkdirSync(legacy);
 try{const source=readFileSync(new URL('../install-master.sh',import.meta.url),'utf8'),fn=/select_install_target\(\) \{[\s\S]*?\n\}/.exec(source)[0];assert.ok(source.includes("target='/root/FireflyProbe'"));
 const run=explicit=>{const r=spawnSync(bash,['-c',fn+'\nselect_install_target "$1" "$2" "$3"','test',pathForShell(preferred),pathForShell(legacy),String(explicit)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim();};
 assert.equal(run(false),pathForShell(preferred));writeFileSync(join(legacy,'.env'),'');writeFileSync(join(legacy,'compose.yaml'),'');assert.equal(run(false),pathForShell(legacy));assert.equal(run(true),pathForShell(preferred));writeFileSync(join(preferred,'.env'),'');writeFileSync(join(preferred,'compose.yaml'),'');assert.equal(run(false),pathForShell(preferred));
 const normalize=source.split('\n').find(line=>line.includes('expected_project=$(')),normalized=spawnSync(bash,['-c','target=/root/FireflyProbe\n'+normalize+'\nprintf "%s" "$expected_project"'],{encoding:'utf8'});assert.equal(normalized.status,0);assert.equal(normalized.stdout,'fireflyprobe');
 }finally{rmSync(dir,{recursive:true,force:true});}
});
test('主控卸载先停止和备份再移除，导出失败不移除；保留卷且不影响其他项目',()=>{
 const dir=mkdtempSync(join(tmpdir(),'uninstall-master-')),mock=join(dir,'mock'),target=join(dir,'FireflyProbe'),trace=join(dir,'trace');mkdirSync(mock);mkdirSync(target);writeFileSync(join(target,'.env'),'');writeFileSync(join(target,'compose.yaml'),'');writeFileSync(join(target,'compose.https.yaml'),'');
 const script=join(dir,'uninstall.sh');writeFileSync(script,readFileSync(new URL('../uninstall-master.sh',import.meta.url),'utf8').replace(/^\[\[ \$EUID.*$/m,'# Root check bypassed only in this isolated fixture.'));
 writeFileSync(join(mock,'docker'),'#!/usr/bin/env bash\nset -eu\nprintf "%s\\n" "$*" >> "$TEST_TRACE"\nfor arg in "$@"; do\n case "$arg" in\n ps) echo fixture-container; exit 0;;\n cp) if [[ "${FAIL_COPY:-}" == 1 ]]; then exit 1; fi; mkdir -p "${!#}"; exit 0;;\n esac\ndone\n',{mode:0o755});
 try{const env={...process.env,TEST_TRACE:pathForShell(trace)},command='export PATH="$1:$PATH"; bash "$2" --dir "$3"',args=['-c',command,'fixture',pathForShell(mock),pathForShell(script),pathForShell(target)];let r=spawnSync(bash,args,{env,encoding:'utf8'});assert.equal(r.status,0,r.stderr);let log=readFileSync(trace,'utf8');assert.ok(log.indexOf(' stop')<log.indexOf(' cp '));assert.ok(log.indexOf(' cp ')<log.indexOf(' down'));assert.ok(!log.includes('--volumes')&&!log.includes('prune'));assert.ok(existsSync(join(target,'.env')));assert.ok(existsSync(join(target,'uninstall-backups')));
 writeFileSync(trace,'');r=spawnSync(bash,args,{env:{...env,FAIL_COPY:'1'},encoding:'utf8'});assert.notEqual(r.status,0);log=readFileSync(trace,'utf8');assert.ok(!log.includes(' down'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});
