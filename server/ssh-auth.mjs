import ssh2 from 'ssh2';
const fail=message=>{throw Object.assign(new Error(message),{status:400});};
export const hasSSHCredentials=n=>(n?.ssh_auth_mode||'password')==='key'?Boolean(n?.ssh_private_key):Boolean(n?.ssh_password);
function privateKey(value,passphrase){let parsed;try{parsed=ssh2.utils.parseKey(value,passphrase||undefined);}catch{fail('SSH 私钥无效或口令不正确，请使用支持的 OpenSSH / PEM 私钥');}if(parsed instanceof Error||Array.isArray(parsed)||!parsed?.isPrivateKey?.())fail('SSH 私钥无效或口令不正确，请使用支持的 OpenSSH / PEM 私钥，不要填写公钥');}
export function sshCredentialFields(input,old,vault,id){
 const mode=input.ssh_auth_mode??old.ssh_auth_mode??'password';if(!['password','key'].includes(mode))fail('SSH 认证方式无效');
 for(const [field,limit] of [['ssh_password',1024],['ssh_private_key',65536],['ssh_passphrase',1024]])if(input[field]!==undefined&&(typeof input[field]!=='string'||input[field].length>limit||input[field].includes('\0')))fail('SSH 凭据格式或长度无效');
 if(input.ssh_clear!==undefined&&typeof input.ssh_clear!=='boolean')fail('SSH 清除选项无效');
 if(input.ssh_clear)return {ssh_auth_mode:'password',ssh_password:'',ssh_private_key:'',ssh_passphrase:''};
 const seal=(field,value)=>!value?'':old.id===id&&old[field]&&vault.open(old[field],old.id)===value?old[field]:vault.seal(value,id);
 if(mode==='password'){const password=input.ssh_password||((old.ssh_auth_mode||'password')==='password'&&old.ssh_password?vault.open(old.ssh_password,old.id):'');if(old.ssh_auth_mode==='key'&&!password)fail('切换密码认证时请填写 SSH 密码');return {ssh_auth_mode:mode,ssh_password:seal('ssh_password',password),ssh_private_key:'',ssh_passphrase:''};}
 const changed=Boolean(input.ssh_private_key?.trim()),key=changed?input.ssh_private_key.trim().replace(/\r\n/g,'\n'):(old.ssh_auth_mode==='key'&&old.ssh_private_key?vault.open(old.ssh_private_key,old.id):'');
 const phrase=input.ssh_passphrase||(!changed&&old.ssh_auth_mode==='key'&&old.ssh_passphrase?vault.open(old.ssh_passphrase,old.id):'');
 if(!key)fail('请选择或粘贴 SSH 私钥');privateKey(key,phrase);
 return {ssh_auth_mode:mode,ssh_password:'',ssh_private_key:seal('ssh_private_key',key),ssh_passphrase:seal('ssh_passphrase',phrase)};
}
export function sshAuthOptions(n,vault){if(!hasSSHCredentials(n))fail('请先填写 SSH 密码或私钥');if((n.ssh_auth_mode||'password')==='password')return {password:vault.open(n.ssh_password,n.id)};const key=vault.open(n.ssh_private_key,n.id),phrase=n.ssh_passphrase?vault.open(n.ssh_passphrase,n.id):'';privateKey(key,phrase);return {privateKey:key,...(phrase?{passphrase:phrase}:{})};}
export function sshRedactor(n,vault,extra=[]){const options=sshAuthOptions(n,vault),secrets=[...Object.values(options),...extra,...(options.privateKey?options.privateKey.split(/\r?\n/).map(s=>s.trim()):[])].filter(Boolean).sort((a,b)=>b.length-a.length);return line=>{for(const secret of secrets)line=line.replaceAll(secret,'[已隐藏]');return line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g,'');};}
