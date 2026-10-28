const crypto=require('node:crypto');
function serviceClient({env=process.env,fetchImpl=fetch}={}){
 return async function call(endpoint,{method='GET',body,prefer}={}){
  const key=env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY;
  if(!env.SUPABASE_URL||!key)throw Object.assign(new Error('Configure the server Supabase connection.'),{status:503});
  const response=await fetchImpl(new URL(endpoint,env.SUPABASE_URL),{method,headers:{apikey:key,Authorization:`Bearer ${key}`,...(body?{'Content-Type':'application/json'}:{}),...(prefer?{Prefer:prefer}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(25000)});
  const text=await response.text();let data;try{data=text?JSON.parse(text):null;}catch{}
  if(!response.ok)throw Object.assign(new Error(['42P01','PGRST202','PGRST205'].includes(data?.code)?'Run migration 016 to enable cloud sessions and the gym bridge.':'Cloud storage could not complete the request. Try again.'),{status:503});
  return data;
 };
}
class CloudRuntimeStore{
 constructor(namespace,options={}){this.namespace=namespace;this.env=options.env||process.env;this.call=serviceClient(options);}
 entryKey(id){return this.namespace+':'+crypto.createHash('sha256').update(String(id)).digest('hex');}
 encryptionKey(){const secret=this.env.PORTAL_SESSION_SECRET;if(!secret||secret.length<32)throw Object.assign(new Error('Configure a stable PORTAL_SESSION_SECRET with at least 32 characters.'),{status:503});return crypto.createHash('sha256').update(secret).digest();}
 encode(id,value){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',this.encryptionKey(),iv);cipher.setAAD(Buffer.from(this.entryKey(id)));const data=Buffer.concat([cipher.update(JSON.stringify(value,(k,v)=>k==='refreshing'?undefined:v)),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64url');}
 decode(id,value){const bytes=Buffer.from(value,'base64url'),cipher=crypto.createDecipheriv('aes-256-gcm',this.encryptionKey(),bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));cipher.setAAD(Buffer.from(this.entryKey(id)));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString());}
 async get(id){if(!id)return undefined;const rows=await this.call('/rest/v1/portal_runtime?select=encrypted_value&key=eq.'+encodeURIComponent(this.entryKey(id))+'&limit=1');return rows[0]?this.decode(id,rows[0].encrypted_value):undefined;}
 async set(id,value){await this.call('/rest/v1/portal_runtime?on_conflict=key',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{key:this.entryKey(id),encrypted_value:this.encode(id,value),updated_at:new Date().toISOString()}});return this;}
 async ensure(id,factory){const existing=await this.get(id);if(existing)return existing;await this.call('/rest/v1/portal_runtime?on_conflict=key',{method:'POST',prefer:'resolution=ignore-duplicates,return=minimal',body:{key:this.entryKey(id),encrypted_value:this.encode(id,factory())}});return this.get(id);}
 async delete(id){if(id)await this.call('/rest/v1/portal_runtime?key=eq.'+encodeURIComponent(this.entryKey(id)),{method:'DELETE'});}
 async refresh(id,callback){
  const lease=crypto.randomUUID(),key=this.entryKey(id);let acquired=false;
  for(let i=0;i<30;i++){if(await this.call('/rest/v1/rpc/claim_portal_runtime_lock',{method:'POST',body:{entry_key:key,lease_token:lease}})){acquired=true;break;}await new Promise(r=>setTimeout(r,200));const current=await this.get(id);if(!current)throw Object.assign(new Error('Please sign in to continue.'),{status:401});if(current.expiresAt>Date.now()+60000)return current;}
  if(!acquired)throw Object.assign(new Error('Your session is refreshing. Please try again.'),{status:503});
  try{const current=await this.get(id);if(!current)throw Object.assign(new Error('Please sign in to continue.'),{status:401});if(current.expiresAt>Date.now()+60000)return current;const updated=await callback(current);
   const rows=await this.call('/rest/v1/portal_runtime?key=eq.'+encodeURIComponent(key)+'&lock_token=eq.'+lease,{method:'PATCH',prefer:'return=representation',body:{encrypted_value:this.encode(id,updated),updated_at:new Date().toISOString()}});
   if(!rows.length)throw Object.assign(new Error('Session refresh lease expired. Try again.'),{status:503});return updated;
  }finally{await this.call('/rest/v1/portal_runtime?key=eq.'+encodeURIComponent(key)+'&lock_token=eq.'+lease,{method:'PATCH',body:{lock_token:null,lock_until:null}});}
 }
 *keys(){} // Cloud functions never run the local delivery loop.
 [Symbol.iterator](){return [][Symbol.iterator]();}
}
module.exports={CloudRuntimeStore,serviceClient};
