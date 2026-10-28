const indiaDay=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const {reservedDevices,isReservedMember}=require('./reservedDeviceIds');
const {validDate}=require('./reporting');
function validateAccessDate(value,now=new Date()){
  const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const tomorrow=new Date(new Date(today+'T12:00:00Z').getTime()+86400000).toISOString().slice(0,10);
  if(!validDate(value)||![today,tomorrow].includes(value))throw new Error('Choose today or tomorrow for device access syncing.');
  return value;
}
function deviceTargets(snapshot,memberIds,today=indiaDay()){
  const ids=new Set(memberIds);const used=new Set(),reserved=reservedDevices(snapshot);
  return snapshot.members.filter(m=>ids.has(m.id)).map(m=>{
    const uid=Number(m.device_user_id);
    if(!Number.isInteger(uid)||uid<1||uid>65535||used.has(uid))throw new Error('Invalid or duplicate Supabase fingerprint ID.');used.add(uid);
    const protectedTeam=isReservedMember(m,reserved);
    const active=protectedTeam?null:!m.is_archived&&snapshot.memberships.some(p=>p.member_id===m.id&&p.status==='confirmed'&&p.start_date<=today&&p.end_date>=today);
    return {uid,userId:String(uid),name:m.full_name,memberId:m.id,active,protectedTeam};
  });
}
function deviceName(name){let s=String(name??'').trim();while(Buffer.byteLength(s,'utf8')>24)s=Array.from(s).slice(0,-1).join('');return s.trimEnd();}
function storedNameMatches(stored,expected){
  const actual=String(stored??'').split('\0')[0];const canonical=deviceName(expected);
  // zklib-js reads the 24-byte name as ASCII, even when setUser writes UTF-8.
  // Bound its decoded field so adjacent card bytes cannot become name bytes.
  return actual.trim()===canonical||actual.slice(0,24).trim()===Buffer.from(canonical,'utf8').toString('ascii').trim();
}
function verifiedUserMatches(user,target){return Number(user.uid)===target.uid&&String(user.userId).trim()===target.userId&&storedNameMatches(user.name,target.name);}
async function syncFingerprint(snapshot,jobs,adapter){
  const ids=jobs.map(j=>j.payload?.member_id).filter(Boolean),targets=deviceTargets(snapshot,ids,snapshot.access_date||indiaDay());
  if(targets.length!==new Set(ids).size)throw new Error('A fingerprint job has no Supabase member mapping.');
  const writable=targets.filter(t=>!t.protectedTeam),protectedTeam=targets.length-writable.length;
  if(!writable.length)return {updated:0,processed:targets.length,protectedTeam,accessAllowed:0,accessRestricted:0};
  let connected=false;try{
    const deadline=Date.now()+25*60*1000;
    await adapter.connect();connected=true;const users=await adapter.users();
    // Preflight every target before any mutation. Never overwrite another UID,
    // delete fingerprint templates, or restrict unrelated device users.
    for(const t of writable){const byUid=users.find(u=>Number(u.uid)===t.uid),byId=users.find(u=>String(u.userId)===t.userId);
      if((byUid&&String(byUid.userId)!==t.userId)||(byId&&Number(byId.uid)!==t.uid))throw new Error('Fingerprint UID/user ID conflict for '+t.userId+'. Resolve the mapping before syncing.');
    }
    await adapter.prepare();let updated=0;
    for(const t of writable){const existing=users.find(u=>Number(u.uid)===t.uid);const name=deviceName(t.name);
      if(Date.now()>deadline)throw new Error('Device sync time limit reached. Retry the selected access date to finish the update.');
      if(!existing||!storedNameMatches(existing.name,name)){await adapter.upsert({...t,name},existing);updated++;}
      await adapter.access(t.uid,t.active);
    }
    await adapter.refresh();return {updated,processed:targets.length,protectedTeam,accessAllowed:writable.filter(t=>t.active).length,accessRestricted:writable.filter(t=>!t.active).length};
  }finally{if(connected)await adapter.disconnect();}
}
function realAdapter(){const {connectDevice}=require('./device');const {ensureAccessTimezones,allowUserAccess,restrictUserAccess,refreshDevice}=require('./accessControl');let zk;
  return {async connect(){zk=await connectDevice();if(!zk)throw new Error('Fingerprint device is unreachable.');},async users(){return (await zk.getUsers()).data||[];},prepare:()=>ensureAccessTimezones(zk),
    async upsert(t,existing){
      await zk.setUser(t.uid,t.userId,t.name,existing?.password||'',Number(existing?.role||0),Number(existing?.cardno||0));
      const users=(await zk.getUsers()).data||[];
      if(!users.some(u=>verifiedUserMatches(u,t)))throw new Error('Fingerprint user update could not be verified for '+t.userId);
    },
    access:(uid,active)=>active?allowUserAccess(zk,uid):restrictUserAccess(zk,uid),refresh:()=>refreshDevice(zk),disconnect:()=>zk.disconnect()};
}
module.exports={deviceTargets,deviceName,syncFingerprint,realAdapter,validateAccessDate,storedNameMatches,verifiedUserMatches};
