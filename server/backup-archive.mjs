import {createCipheriv,createDecipheriv,randomBytes,scryptSync} from 'node:crypto';
import {createReadStream,createWriteStream,openSync,readSync,writeSync,closeSync,rmSync,renameSync,statSync} from 'node:fs';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';

const error=message=>Object.assign(new Error(message),{status:400});
const key=(password,salt)=>{if(typeof password!=='string'||password.length<12||password.length>256)throw error('备份加密密码需为 12–256 个字符');return scryptSync(password,salt,32);};
export async function encryptArchive(sqlite,out,password,sshKey,signal){
 if(!Buffer.isBuffer(sshKey)||sshKey.length!==32)throw error('凭据密钥无效');if(statSync(sqlite).size>512*1024*1024-128*1024)throw error('数据库超过远程备份大小限制');
 const salt=randomBytes(16),iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key(password,salt),iv),header=Buffer.concat([Buffer.from('FFB1'),salt,iv,Buffer.alloc(16)]),prefix=Buffer.from(JSON.stringify({version:1,ssh_key:sshKey.toString('base64')})+'\n');
 const input=Readable.from((async function*(){yield prefix;for await(const chunk of createReadStream(sqlite))yield chunk;})());
 const output=createWriteStream(out,{flags:'wx',mode:0o600});output.write(header);
 try{await pipeline(input,cipher,output,{signal});const fd=openSync(out,'r+');try{writeSync(fd,cipher.getAuthTag(),0,16,32);}finally{closeSync(fd);}}
 catch(e){rmSync(out,{force:true});throw e;}
}
export async function decryptArchive(file,password){
 const header=Buffer.alloc(48),fd=openSync(file,'r');let bytes;try{bytes=readSync(fd,header);}finally{closeSync(fd);}if(header.subarray(0,4).toString()!=='FFB1')return null;if(bytes!==48)throw error('加密备份不完整');
 const cipher=createDecipheriv('aes-256-gcm',key(password,header.subarray(4,20)),header.subarray(20,32));cipher.setAuthTag(header.subarray(32,48));let prefix=Buffer.alloc(0),metadata=null;
 const strip=new Transform({transform(chunk,unused,next){if(metadata){next(null,chunk);return;}prefix=Buffer.concat([prefix,chunk]);const end=prefix.indexOf(10);if(end<0){if(prefix.length>128*1024)return next(error('备份元数据过大'));return next();}try{metadata=JSON.parse(prefix.subarray(0,end).toString());if(metadata.version!==1||typeof metadata.ssh_key!=='string'||!/^[A-Za-z0-9+/]{43}=$/.test(metadata.ssh_key)||Buffer.from(metadata.ssh_key,'base64').length!==32)throw error('备份元数据无效');next(null,prefix.subarray(end+1));prefix=Buffer.alloc(0);}catch(e){next(e);}}});
 const output=file+'.decrypted';try{await pipeline(createReadStream(file,{start:48}),cipher,strip,createWriteStream(output,{flags:'wx',mode:0o600}));if(!metadata)throw error('备份元数据缺失');rmSync(file);renameSync(output,file);return metadata;}catch{rmSync(output,{force:true});throw error('备份解密失败：密码错误、文件损坏或格式无效');}
}
