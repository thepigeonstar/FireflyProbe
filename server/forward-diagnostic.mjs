import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../tools/diagnose-forwarding.py',import.meta.url),'utf8');
export function forwardDiagnosticScript(iface='',expected=[]){
 if(typeof iface!=='string'||iface&&!/^[a-zA-Z0-9_.:@-]{1,40}$/.test(iface))throw Object.assign(new Error('统计网卡格式无效'),{status:400});
 if(!Array.isArray(expected)||expected.length>200||expected.some(id=>typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id)))throw Object.assign(new Error('规则编号格式无效'),{status:400});
 // The script is maintained here, never supplied by the browser.
 return "set -eu\nexport PYTHONUTF8=1 PYTHONIOENCODING=utf-8\ncommand -v python3 >/dev/null || { echo '请先安装 Python 3'; exit 1; }\npython3 -u - <<'FIREFLY_DIAGNOSTIC'\n"+source.replace("if __name__ == '__main__':","if False:")+"\nmain(interface="+JSON.stringify(iface)+", seconds=30"+(expected.length?", expected_rule_ids="+JSON.stringify(expected):'')+")\nFIREFLY_DIAGNOSTIC\n";
}
