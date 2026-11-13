import test from 'node:test';import assert from 'node:assert/strict';import {createPrivateKey,createPublicKey,sign,verify} from 'node:crypto';import ssh2 from 'ssh2';import {testSSHKeyPair} from './helpers/ssh-keys.mjs';
test('OpenSSH测试密钥保留Ed25519公钥开头的零字节，原生签名与SSH解析交叉验证',()=>{
 // Public regression vector, never a production key: seed index 36 derives a public key starting with 0x00.
 const seed=Buffer.alloc(32);seed.writeUInt32BE(36,28);const fixture=testSSHKeyPair(seed),native=createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'}),publicBytes=Buffer.from(createPublicKey(native).export({format:'jwk'}).x,'base64url');assert.equal(publicBytes[0],0);assert.equal(publicBytes.length,32);
 const parsed=ssh2.utils.parseKey(fixture.private);assert.ok(!(parsed instanceof Error));assert.equal(parsed.type,'ssh-ed25519');assert.ok(parsed.isPrivateKey());assert.deepEqual(parsed.getPublicSSH(),Buffer.from(fixture.public.split(' ')[1],'base64'));assert.deepEqual(parsed.getPublicSSH().subarray(-32),publicBytes);const data=Buffer.from('leading-zero-key-regression');assert.equal(parsed.verify(data,sign(null,data,native)),true);assert.equal(verify(null,data,createPublicKey(native),parsed.sign(data)),true);
});
test('1000份原生生成的OpenSSH测试密钥均可解析且保持公私钥一致，无重试或跳过',()=>{
 const publicKeys=new Set();for(let i=0;i<1000;i++){const fixture=testSSHKeyPair(),parsed=ssh2.utils.parseKey(fixture.private);assert.ok(!(parsed instanceof Error),'fixture '+i+' must parse');assert.deepEqual(parsed.getPublicSSH(),Buffer.from(fixture.public.split(' ')[1],'base64'));publicKeys.add(fixture.public);}assert.equal(publicKeys.size,1000);
});
