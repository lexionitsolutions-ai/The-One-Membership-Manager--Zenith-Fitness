const {writeFallback,googleSheetsClient}=require('./fallbackMirror');
const {syncFingerprint,realAdapter,validateAccessDate}=require('./supabaseFingerprint');
const {acquireDevice}=require('./deviceLock');
function createSecondaryBridge({rpc,mirror=writeFallback,sheetsClient=googleSheetsClient,fingerprint=syncFingerprint,deviceAdapter=realAdapter,env=process.env,setAccessDate=date=>{env.DEVICE_ACCESS_DATE=date;}}){
  const running=new Set();
  async function run({gymId,token,destination,force=false,manualDate}){
    const key=gymId+':'+destination;
    if(!['google_sheets','fingerprint'].includes(destination))throw new Error('Invalid sync destination.');
    if(destination==='google_sheets'&&!env.FALLBACK_SPREADSHEET_ID)throw new Error('Configure the new fallback spreadsheet ID first.');
    if(manualDate)validateAccessDate(manualDate);
    if(destination==='fingerprint'&&!manualDate&&env.SUPABASE_DEVICE_SYNC_ENABLED!=='1')throw new Error('Automatic fingerprint sync is disabled. Use the dated membership sync control for a manual sync.');
    if(running.has(key))return {busy:true};
    const release=destination==='fingerprint'?acquireDevice():()=>{};if(!release)return {busy:true};
    running.add(key);let lease;
    const call=(name,body)=>rpc(name,body,token);
    try{
      lease=await call('begin_secondary_sync',{target_gym:gymId,target_destination:destination});
      if(lease.busy)return {busy:true};
      if(manualDate)await setAccessDate(manualDate);
      let result={skipped:true};
      if(destination==='fingerprint'){
        let policyDate;try{policyDate=validateAccessDate(env.DEVICE_ACCESS_DATE);}catch{}
        lease.snapshot.access_date=manualDate||policyDate||new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
      }
      if(lease.jobs.length||force||manualDate){
        const jobs=manualDate?lease.snapshot.members.filter(m=>m.device_user_id!==null&&m.device_user_id!==undefined).map(m=>({payload:{member_id:m.id}})):lease.jobs;
        if(manualDate&&!jobs.length)throw new Error('No mapped Supabase members were found. Import existing members before syncing device access.');
        result=destination==='google_sheets'
          ?await mirror({sheets:sheetsClient(),spreadsheetId:env.FALLBACK_SPREADSHEET_ID,snapshot:lease.snapshot})
          :await fingerprint(lease.snapshot,jobs,deviceAdapter());
      }
      const completed=await call('finish_secondary_sync',{target_gym:gymId,target_destination:destination,lease_uuid:lease.lease_id,succeeded:true,error_message:null});
      return {success:true,completed,...result,...(destination==='fingerprint'?{accessDate:lease.snapshot.access_date}:{})};
    }catch(error){
      if(lease?.lease_id)try{await call('finish_secondary_sync',{target_gym:gymId,target_destination:destination,lease_uuid:lease.lease_id,succeeded:false,error_message:error.message});}catch{}
      throw error;
    }finally{running.delete(key);release();}
  }
  return {run};
}
module.exports={createSecondaryBridge};
