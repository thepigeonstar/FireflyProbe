import {randomBytes,scrypt,timingSafeEqual} from 'node:crypto';
import {promisify} from 'node:util';
const derive=promisify(scrypt);
const bad=message=>Object.assign(new Error(message),{status:400});
export function validateUsername(value){if(typeof value!=='string'||!/^[a-zA-Z0-9_.@-]{1,64}$/.test(value))throw bad('账号需为 1–64 位字母、数字或 _.@-');return value;}
export function validatePassword(value){if(typeof value!=='string'||value.length<12||value.length>256||value.includes('REPLACE_WITH'))throw bad('密码需为 12–256 位，不能使用示例占位密码');return value;}
export async function createAccount(db,initialUsername,initialPassword){
  let record;
  const persist=next=>{db.prepare("INSERT INTO settings VALUES('admin_auth',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(JSON.stringify(next));record=next;};
  const existing=db.prepare("SELECT value FROM settings WHERE key='admin_auth'").get();
  if(existing){record=JSON.parse(existing.value);validateUsername(record.username);if(!/^[a-f0-9]{32}$/.test(record.salt)||!/^[a-f0-9]{128}$/.test(record.hash))throw new Error('管理员凭据格式无效，请通过恢复工具重置');}
  else {validateUsername(initialUsername);validatePassword(initialPassword);const salt=randomBytes(16);persist({username:initialUsername,salt:salt.toString('hex'),hash:(await derive(initialPassword,salt,64)).toString('hex')});}
  let generation=0,busy=false;
  async function verify(password){if(typeof password!=='string'||password.length>256)return false;const current=record,epoch=generation,hash=await derive(password,Buffer.from(current.salt,'hex'),64);return epoch===generation&&timingSafeEqual(hash,Buffer.from(current.hash,'hex'));}
  return {
    get username(){return record.username;},get generation(){return generation;},verify,
    async change(input){if(busy)throw Object.assign(new Error('账号正在更新，请稍后重试'),{status:409});busy=true;try{if(!await verify(input.current_password))throw Object.assign(new Error('当前密码不正确'),{status:403});const username=validateUsername(input.username??record.username),password=input.new_password;if(password!==undefined&&password!=='')validatePassword(password);if(username===record.username&&!password)throw bad('请填写新账号或新密码');if(password){const salt=randomBytes(16);persist({username,salt:salt.toString('hex'),hash:(await derive(password,salt,64)).toString('hex')});}else persist({...record,username});generation++;return {username};}finally{busy=false;}}
  };
}
export function validatePaths(input,old={}){
  const admin=input.admin_path??old.admin_path??'/admin',pub=input.public_path??old.public_path??'/';
  const reserved=new Set(['/api','/downloads','/healthz','/install-agent','/network','/servers','/public']);
  const valid=value=>typeof value==='string'&&/^\/[A-Za-z0-9_-]{1,80}$/.test(value)&&!reserved.has(value.toLowerCase());
  if(!valid(admin))throw bad('管理路径需为 / 加 1–80 位字母、数字、横线或下划线，不能使用系统保留路径');
  if(pub!=='/'&&pub!=='/public'&&!valid(pub))throw bad('公开路径可为 / 或一个自定义目录，不能使用系统保留路径');
  if(admin.toLowerCase()===pub.toLowerCase())throw bad('管理路径与公开路径不能相同');
  return {admin_path:admin,public_path:pub};
}
