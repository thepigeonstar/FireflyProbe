import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApp } from '../server/main.mjs';

test('安装文件白名单、二进制校验、禁止下载配置与源码',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'lightprobe-download-'));
  const app=await createApp({password:'download-test-password',dbPath:join(dir,'test.sqlite'),disableTelegram:true});
  await new Promise(r=>app.server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+app.server.address().port;
  try {
    for(const path of ['/install-agent.sh','/downloads/install.sh','/downloads/bootstrap.sh']) {
      const r=await fetch(base+path);assert.equal(r.status,200);assert.match(await r.text(),/^#!(?:\/usr\/bin\/env bash|\/bin\/sh)/);
    }
    const sums=await (await fetch(base+'/downloads/SHA256SUMS')).text();
    for(const name of ['lightprobe','firefly-probe']) for(const arch of ['amd64','arm64']) {
      const file=name+'-agent-linux-'+arch;
      const r=await fetch(base+'/downloads/'+file);assert.equal(r.status,200);
      const bytes=Buffer.from(await r.arrayBuffer());assert.equal(bytes.subarray(0,4).toString(),'\x7fELF');
      const digest=createHash('sha256').update(bytes).digest('hex');assert.ok(sums.includes(digest+'  '+file));
    }
    for(const path of ['/downloads/.env','/downloads/lightprobe-agent.json','/downloads/main.mjs','/downloads/lightprobe-agent-linux-mips','/agent/install.sh']) assert.equal((await fetch(base+path)).status,404);
    assert.equal((await fetch(base+'/api/agent/config')).status,401);
    const docker=readFileSync(new URL('../Dockerfile',import.meta.url),'utf8');
    assert.match(docker,/COPY agent\/install\.sh agent\/bootstrap\.sh/);
  } finally {await app.close();rmSync(dir,{recursive:true,force:true});}
});
