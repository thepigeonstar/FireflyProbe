import {createPrivateKey,generateKeyPairSync,randomBytes} from 'node:crypto';

// Test-only OpenSSH fixture encoder. Generate key material with Node/OpenSSL.
// ssh2 1.17.0 keygen strips ALL leading zero bytes from the DER BIT STRING,
// including possible real public-key bytes, producing a truncated public key.
// Keep the exact 32-byte Ed25519 public value; do not retry or skip bad samples.
// Envelope: https://github.com/openssh/openssh-portable/blob/master/PROTOCOL.key
const u32=value=>{const out=Buffer.alloc(4);out.writeUInt32BE(value);return out;};
const string=value=>{const body=Buffer.isBuffer(value)?value:Buffer.from(value);return Buffer.concat([u32(body.length),body]);};
export function testSSHKeyPair(seed){
 if(seed!==undefined&&(!Buffer.isBuffer(seed)||seed.length!==32))throw Error('Test Ed25519 seed must be 32 bytes');
 const privateKey=seed===undefined?generateKeyPairSync('ed25519').privateKey:createPrivateKey({key:Buffer.concat([Buffer.from('302e020100300506032b657004220420','hex'),seed]),type:'pkcs8',format:'der'});
 const jwk=privateKey.export({format:'jwk'}),publicBytes=Buffer.from(jwk.x,'base64url'),privateBytes=Buffer.from(jwk.d,'base64url');
 if(publicBytes.length!==32||privateBytes.length!==32)throw Error('Unexpected Ed25519 test key length');
 const algorithm='ssh-ed25519',comment='firefly-test-fixture',publicBlob=Buffer.concat([string(algorithm),string(publicBytes)]),check=randomBytes(4);
 let privateBlob=Buffer.concat([check,check,string(algorithm),string(publicBytes),string(Buffer.concat([privateBytes,publicBytes])),string(comment)]);
 const padding=(8-privateBlob.length%8)%8;privateBlob=Buffer.concat([privateBlob,Buffer.from(Array.from({length:padding},(_,i)=>i+1))]);
 const envelope=Buffer.concat([Buffer.from('openssh-key-v1\0'),string('none'),string('none'),string(''),u32(1),string(publicBlob),string(privateBlob)]);
 return {private:'-----BEGIN OPENSSH PRIVATE KEY-----\n'+envelope.toString('base64').match(/.{1,70}/g).join('\n')+'\n-----END OPENSSH PRIVATE KEY-----\n',public:algorithm+' '+publicBlob.toString('base64')+' '+comment};
}
