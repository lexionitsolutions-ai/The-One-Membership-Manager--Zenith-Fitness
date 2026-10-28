const crypto=require('node:crypto');
const {createStaffAccount}=require('./staffAccounts');
function privateNetwork(req){
 const ip=(req.socket?.remoteAddress||req.ip||'').replace(/^::ffff:/,'');
 return ip==='::1'||/^127\./.test(ip)||/^10\./.test(ip)||/^192\.168\./.test(ip)||/^172\.(1[6-9]|2\d|3[01])\./.test(ip)||/^(fc|fd)[0-9a-f:]+$/i.test(ip);
}
function createOpenOperations({store,request,fetchImpl,staffFor}){
 let pending;
 async function acquire(){
  const gymId=process.env.OPEN_OPERATIONS_GYM_ID;
  if(!gymId)throw Object.assign(new Error('Configure the gym for direct form access.'),{status:503});
  let machine=store.get('machine');
  if(!machine){machine={email:`local-operations.${gymId}@staff.zenith.local`,password:crypto.randomBytes(40).toString('base64url'),gymId};store.set('machine',machine);}
  if(machine.gymId!==gymId)throw Object.assign(new Error('Direct form gym configuration changed. Review the operations account setup.'),{status:503});
  if(!machine.created){
   try{await createStaffAccount({input:{name:'Zenith Local Operations',role:'admin',email:machine.email,password:machine.password},gymId,fetchImpl});}
   catch(e){if(e.status!==409)throw e;}
   machine.created=true;store.set('machine',machine);
  }
  if(!machine.accessToken||machine.expiresAt<Date.now()+60000){
   let auth;
   if(machine.refreshToken){try{auth=await request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:{refresh_token:machine.refreshToken}});}catch(e){if(e.status!==401)throw e;}}
   auth ||= await request('/auth/v1/token?grant_type=password',{method:'POST',body:{email:machine.email,password:machine.password}});
   machine={...machine,accessToken:auth.access_token,refreshToken:auth.refresh_token,expiresAt:Date.now()+auth.expires_in*1000,userId:auth.user.id};store.set('machine',machine);
  }
  // Repair only our own generated machine account if an older setup lacks the
  // Auth insert trigger. Never change or reactivate an existing staff assignment.
  if(!machine.provisioned){
   const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
   const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
   const endpoint=new URL('/rest/v1/staff',process.env.SUPABASE_URL);
   endpoint.searchParams.set('select','id,role,is_active');endpoint.searchParams.set('gym_id','eq.'+gymId);endpoint.searchParams.set('user_id','eq.'+machine.userId);
   const check=await fetchImpl(endpoint,{headers,signal:AbortSignal.timeout(20000)});const assignments=await check.json();
   if(!check.ok||!Array.isArray(assignments))throw Object.assign(new Error('Could not verify the local operations staff assignment.'),{status:503});
   if(!assignments.length){
    const created=await fetchImpl(new URL('/rest/v1/staff',process.env.SUPABASE_URL),{method:'POST',headers,
     body:JSON.stringify({gym_id:gymId,user_id:machine.userId,full_name:'Zenith Local Operations',role:'admin',is_active:true}),signal:AbortSignal.timeout(20000)});
    if(!created.ok&&created.status!==409)throw Object.assign(new Error('Could not enable the local operations account.'),{status:503});
   }
   machine.provisioned=true;store.set('machine',machine);
  }
  const staff=await staffFor(machine.accessToken,machine.userId);
  if(staff.gym_id!==gymId||staff.role!=='admin')throw Object.assign(new Error('The local operations account is disabled or has a different gym role.'),{status:403});
  return {staff,session:{accessToken:machine.accessToken},openAccess:true};
 }
 return async req=>{
  if(process.env.OPEN_OPERATIONS_ENABLED!=='1'||!privateNetwork(req))throw Object.assign(new Error('Please sign in to continue.'),{status:401});
  if(req.headers['sec-fetch-site']==='cross-site')throw Object.assign(new Error('Open the forms directly from the gym app.'),{status:403});
  pending ||= acquire().finally(()=>{pending=null;});return pending;
 };
}
module.exports={createOpenOperations,privateNetwork};
