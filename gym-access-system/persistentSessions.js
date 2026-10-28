const fs=require('node:fs');const path=require('node:path');const crypto=require('node:crypto');
// Tokens and the generated machine-account credential stay encrypted on disk.
class PersistentSessions extends Map {
 constructor(directory,name='sessions'){
  super();this.directory=directory;fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const keyFile=path.join(directory,'session.key');
  try{this.key=fs.readFileSync(keyFile);}catch(e){if(e.code!=='ENOENT')throw e;try{fs.writeFileSync(keyFile,crypto.randomBytes(32),{flag:'wx',mode:0o600});}catch(x){if(x.code!=='EEXIST')throw x;}this.key=fs.readFileSync(keyFile);}
  this.file=path.join(directory,name+'.encrypted');
  try{const stored=fs.readFileSync(this.file);const decipher=crypto.createDecipheriv('aes-256-gcm',this.key,stored.subarray(0,12));decipher.setAuthTag(stored.subarray(12,28));
   for(const [id,value] of JSON.parse(Buffer.concat([decipher.update(stored.subarray(28)),decipher.final()]).toString()))super.set(id,value);
  }catch(e){if(e.code!=='ENOENT')throw new Error('Saved sessions could not be read. Keep the session key and encrypted files together.');}
 }
 persist(){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.key,iv);
  const encrypted=Buffer.concat([cipher.update(JSON.stringify([...this],(key,value)=>key==='refreshing'?undefined:value)),cipher.final()]);
  const temp=this.file+'.tmp';fs.writeFileSync(temp,Buffer.concat([iv,cipher.getAuthTag(),encrypted]),{mode:0o600});fs.renameSync(temp,this.file);
 }
 set(id,value){super.set(id,value);if(this.file)this.persist();return this;}
 delete(id){const result=super.delete(id);if(result&&this.file)this.persist();return result;}
}
module.exports={PersistentSessions};
