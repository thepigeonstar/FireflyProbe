#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
[[ -f compose.yaml && -f .env ]] || { echo '请先把更新包解压到原 lightprobe 目录，保留原 .env。' >&2; exit 1; }
expected_version=$(sed -n 's/.*data-build="\([^"]*\)".*/\1/p' web/index.html)
[[ -n "$expected_version" && "$expected_version" != *$'\n'* ]] || { echo '无法读取新版本标记，请检查安装文件。' >&2; exit 1; }
container=$(docker compose ps -q lightprobe)
if [[ -n "$container" ]]; then
  # Compatible with older images that do not yet contain tools/backup.mjs.
  docker compose exec -T lightprobe node --input-type=module -e '
    import {DatabaseSync,backup} from "node:sqlite";
    import {mkdirSync,readdirSync,statSync,rmSync,chmodSync,writeFileSync} from "node:fs";
    import {join} from "node:path";
    const directory=process.env.DATA_DIR||"/app/data",folder=join(directory,"backups");
    mkdirSync(folder,{recursive:true});
    const db=new DatabaseSync(join(directory,"lightprobe.sqlite"),{readOnly:true});
    try{const name="backup-"+Date.now()+"-before-update.sqlite";await backup(db,join(folder,name));chmodSync(join(folder,name),0o600);writeFileSync(join(folder,name)+".ready","ok\n",{mode:0o600});const cfg=JSON.parse(db.prepare("SELECT value FROM settings WHERE key=?").get("config")?.value||"{}");const keep=Math.max(1,Math.min(30,cfg.backup_keep||7));const files=readdirSync(folder).filter(x=>/^backup-[a-zA-Z0-9-]+\.sqlite$/.test(x)).sort((a,b)=>statSync(join(folder,b)).mtimeMs-statSync(join(folder,a)).mtimeMs);for(const old of files.slice(keep)){rmSync(join(folder,old));rmSync(join(folder,old)+".ready",{force:true});}console.log("更新前备份已保存："+name);}finally{db.close();}
  '
else
  echo '主控未运行，使用已有镜像创建更新前备份。'
  docker compose run --rm --no-deps -T lightprobe node --input-type=module -e '
    import {DatabaseSync,backup} from "node:sqlite";
    import {mkdirSync,chmodSync,writeFileSync} from "node:fs";import {join} from "node:path";
    const directory=process.env.DATA_DIR||"/app/data",folder=join(directory,"backups");mkdirSync(folder,{recursive:true});const db=new DatabaseSync(join(directory,"lightprobe.sqlite"),{readOnly:true});try{const file=join(folder,"backup-"+Date.now()+"-before-update.sqlite");await backup(db,file);chmodSync(file,0o600);writeFileSync(file+".ready","ok\n",{mode:0o600});console.log("更新前备份已保存");}finally{db.close();}
  '
fi
docker compose up --build -d --force-recreate lightprobe
for ((attempt=0; attempt<15; attempt++)); do
  if page_html=$(curl -fsS http://127.0.0.1:8080/ 2>/dev/null); then
    if [[ "$page_html" == *"data-build=\"$expected_version\""* ]]; then
      echo "已验证：运行中的主控页面是 Firefly Probe v$expected_version。浏览器按 Ctrl+F5 刷新。"
      exit 0
    fi
  fi
  sleep 2
done
echo "尚未检测到 v$expected_version，请查看主控日志：" >&2
docker compose logs --tail=30 lightprobe
exit 1
