import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
const bash=process.platform==='win32'?'D:/Program Files/Git/bin/bash.exe':'bash';
const shellPath=p=>p.replaceAll('\\','/').replace(/^([A-Z]):\//i,(_,drive)=>'/'+drive.toLowerCase()+'/');
test('采集端两个入口支持 Debian 11/12/13，旧版本拒绝时显示原因；Ubuntu 范围保持不变',()=>{
 for(const file of ['bootstrap.sh','install.sh']){const text=readFileSync(new URL('../agent/'+file,import.meta.url),'utf8'),gate=/case "\$ID" in[\s\S]*?\nesac/.exec(text)[0],compare='dpkg(){ local smallest; smallest=$(printf "%s\\n%s\\n" "$2" "$4" | sort -V | head -n1); [[ "$smallest" == "$4" ]]; }';
  for(const [id,version,accepted] of [['debian','11',true],['debian','12',true],['debian','13',true],['debian','10',false],['ubuntu','22.04',true],['ubuntu','24.04',true],['ubuntu','20.04',false],['alpine','3.20',false]]){const run=spawnSync(bash,['-c',compare+'\nID=$1; VERSION_ID=$2\n'+gate,'fixture',id,version],{encoding:'utf8'});assert.equal(run.status===0,accepted,file+' '+id+' '+version+' '+run.stderr);if(!accepted)assert.ok((run.stdout+run.stderr).trim().length>0);}
 }
});
test('安装失败显示阶段、行号和退出码，不输出含密钥的命令',()=>{
 const dir=mkdtempSync(join(tmpdir(),'agent-errors-'));
 try{for(const file of ['bootstrap.sh','install.sh']){const text=readFileSync(new URL('../agent/'+file,import.meta.url),'utf8'),trap=/report_install_error\(\) \{[\s\S]*?\n\}\ntrap report_install_error ERR/.exec(text)[0],script=join(dir,file);writeFileSync(script,"set -Eeuo pipefail\nphase='下载安装脚本和采集程序'\n"+trap+"\nbash -c 'exit 7' FAKE_NODE_SECRET_NOT_FOR_LOGS\n");const run=spawnSync(bash,[shellPath(script)],{encoding:'utf8'});assert.equal(run.status,7);assert.ok(run.stderr.includes('下载安装脚本和采集程序')&&run.stderr.includes('退出码 7'));assert.ok(!run.stderr.includes('FAKE_NODE_SECRET'));}}
 finally{rmSync(dir,{recursive:true,force:true});}
});
test('vnStat 2.6 不写入不存在的 UseUTC，新版支持时关闭 UTC 并保留其他配置',()=>{
 const dir=mkdtempSync(join(tmpdir(),'vnstat-options-')),script=join(dir,'fixture.sh'),config=join(dir,'vnstat.conf');
 try{const source=readFileSync(new URL('../agent/install.sh',import.meta.url),'utf8'),detect=/supports_utc=false\nif vnstat --showconfig[^\n]+/.exec(source)[0],write=/  if \[\[ "\$supports_utc" == true \]\]; then[\s\S]*?\n  fi/.exec(source)[0].replaceAll('/etc/vnstat.conf','"$fixture_config"');
  for(const [advertised,initial,expected] of [['','DailyDays 730\n',false],['UseUTC 0','DailyDays 730\n',true],['UseUTC 0','DailyDays 730\nUseUTC 1\n',true]]){writeFileSync(config,initial);writeFileSync(script,'set -euo pipefail\nfixture_config=$1; advertised=$2\nvnstat(){ printf "%s\\n" "$advertised"; }\n'+detect+'\n'+write+'\n');const result=spawnSync(bash,[shellPath(script),shellPath(config),advertised],{encoding:'utf8'});assert.equal(result.status,0,result.stderr);const content=readFileSync(config,'utf8');assert.equal(content.includes('UseUTC 0'),expected);assert.ok(content.includes('DailyDays 730'));assert.ok(!content.includes('UseUTC 1'));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});
