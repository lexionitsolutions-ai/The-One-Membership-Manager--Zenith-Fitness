const {resolveStaffLogin}=require('./staffLogin');

function staffAccountInput(body) {
  const name=String(body.full_name||'').trim();
  const role=body.role;
  const login=String(body.login||'').trim();
  const email=resolveStaffLogin(login);
  const password=body.password;
  if(!name||name.length>150||!['admin','receptionist','trainer'].includes(role))
    throw Object.assign(new Error('Enter a staff name and choose a valid role.'),{status:400});
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||email.length>254)
    throw Object.assign(new Error('Enter a valid email address or contact number.'),{status:400});
  if(!login.includes('@')&&!/^(?:\+91|91)?\d{10}$/.test(login.replace(/[\s()-]/g,'')))
    throw Object.assign(new Error('Enter a valid 10-digit contact number or email address.'),{status:400});
  if(typeof password!=='string'||password.length<8||password.length>1024)
    throw Object.assign(new Error('Use a password with at least 8 characters.'),{status:400});
  return {name,role,email,password};
}

async function createStaffAccount({input,gymId,fetchImpl=fetch}) {
  const key=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key)throw Object.assign(new Error('Staff account creation needs a Supabase secret key in the server configuration. Ask the administrator to complete the setup in docs/staff-accounts.md.'),{status:503});
  let response;
  try {
    response=await fetchImpl(new URL('/auth/v1/admin/users',process.env.SUPABASE_URL),{
      method:'POST',headers:{apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'},
      body:JSON.stringify({email:input.email,password:input.password,email_confirm:true,
        app_metadata:{zenith_staff:{gym_id:gymId,full_name:input.name,role:input.role}}}),
      signal:AbortSignal.timeout(20000)
    });
  } catch {
    throw Object.assign(new Error('Account creation could not be confirmed. Refresh Staff before retrying; the account may already have been created.'),{status:502});
  }
  const data=await response.json().catch(()=>null);
  if(!response.ok){
    const duplicate=['email_exists','user_already_exists'].includes(data?.code)||/already.*registered|already.*exists/i.test(data?.msg||'');
    throw Object.assign(new Error(duplicate?'That login already exists. Edit its existing staff entry; its password has not been changed.':response.status===422?'Supabase rejected the account details. Check the email and password requirements.':'Staff account could not be created. Check the server secret key and migration 013.'),{status:duplicate?409:response.status===422?400:502});
  }
  const user=data?.user||data;
  if(!user?.id)throw Object.assign(new Error('Account creation returned an unexpected response. Refresh Staff before retrying.'),{status:502});
  // Some Auth versions apply app metadata after the initial user INSERT. Verify
  // provisioning before reporting success, and support the older insert trigger.
  const headers={apikey:key,Authorization:`Bearer ${key}`,'Content-Type':'application/json'};
  const endpoint=new URL('/rest/v1/staff',process.env.SUPABASE_URL);
  endpoint.search=new URLSearchParams({select:'id,role,is_active',gym_id:'eq.'+gymId,user_id:'eq.'+user.id});
  const check=await fetchImpl(endpoint,{headers,signal:AbortSignal.timeout(20000)});
  const assignments=await check.json().catch(()=>null);
  if(!check.ok||!Array.isArray(assignments))throw Object.assign(new Error('The login was created, but its gym access could not be verified. Ask your administrator to repair the staff assignment before retrying.'),{status:503});
  if(!assignments.length){
    const linked=await fetchImpl(new URL('/rest/v1/staff',process.env.SUPABASE_URL),{method:'POST',headers,
      body:JSON.stringify({gym_id:gymId,user_id:user.id,full_name:input.name,role:input.role,is_active:true}),signal:AbortSignal.timeout(20000)});
    if(!linked.ok)throw Object.assign(new Error('The login was created, but its staff role could not be assigned. Ask your administrator to repair its gym access.'),{status:503});
  }else if(assignments[0].role!==input.role||!assignments[0].is_active){
    throw Object.assign(new Error('The new login has an unexpected gym role. Review its staff assignment.'),{status:503});
  }
  return {userId:user.id};
}
module.exports={staffAccountInput,createStaffAccount};
