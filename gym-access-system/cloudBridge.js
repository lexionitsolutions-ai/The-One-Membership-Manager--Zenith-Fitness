const crypto=require('node:crypto');const {serviceClient}=require('./cloudRuntime');
function createCloudBridge(options={}){
 const call=serviceClient(options);
 async function status(gymId){const rows=await call('/rest/v1/bridge_status?select=last_seen&gym_id=eq.'+encodeURIComponent(gymId)+'&limit=1');return {online:Boolean(rows[0]&&Date.now()-new Date(rows[0].last_seen).getTime()<90000),last_seen:rows[0]?.last_seen||null};}
 async function enqueue(gymId,actor,kind,payload){const bridge=await status(gymId);if(!bridge.online)throw Object.assign(new Error('The gym computer bridge is offline. Start the local Zenith app on the gym computer, then retry.'),{status:503});const id=await call('/rest/v1/rpc/enqueue_bridge_request',{method:'POST',body:{target_gym:gymId,actor,request_kind:kind,request_payload:payload}});return {queued:true,jobId:id};}
 async function job(gymId,id){if(!/^[0-9a-f-]{36}$/i.test(id))throw Object.assign(new Error('Invalid job identifier.'),{status:400});const rows=await call('/rest/v1/bridge_requests?select=id,kind,status,result,error,created_at,expires_at&gym_id=eq.'+encodeURIComponent(gymId)+'&id=eq.'+id+'&limit=1');if(!rows[0])throw Object.assign(new Error('Bridge request not found.'),{status:404});return rows[0];}
 function startWorker({getContext,bridge,attendanceImporter}){
  let running=false;
  const timer=setInterval(async()=>{
   let auth;try{auth=await getContext();await call('/rest/v1/bridge_status?on_conflict=gym_id',{method:'POST',prefer:'resolution=merge-duplicates,return=minimal',body:{gym_id:auth.staff.gym_id,last_seen:new Date().toISOString()}});}catch{return;}
   if(running)return;running=true;const lease=crypto.randomUUID();let request;
   try{
    request=await call('/rest/v1/rpc/claim_bridge_request',{method:'POST',body:{target_gym:auth.staff.gym_id,lease_token:lease}});if(!request)return;
    const allowed=await call('/rest/v1/staff?select=role&gym_id=eq.'+encodeURIComponent(request.gym_id)+'&user_id=eq.'+encodeURIComponent(request.requested_by)+'&is_active=eq.true&limit=1');
    if(!allowed[0]||!(request.kind==='attendance_refresh'?['admin','receptionist']:['admin']).includes(allowed[0].role))throw new Error('The requesting staff account no longer has access.');
    let result;
    if(request.kind==='attendance_refresh')result=await attendanceImporter.run(request.gym_id,request.requested_by);
    else{
     const destination=request.kind==='fingerprint_date_sync'?'fingerprint':request.payload.destination;
     result=await bridge.run({gymId:request.gym_id,token:auth.session.accessToken,destination,force:true,...(request.kind==='fingerprint_date_sync'?{manualDate:request.payload.date}:{})});
     if(destination==='fingerprint'&&result.success&&!result.busy){try{result.attendanceRefresh=await attendanceImporter.run(request.gym_id,request.requested_by);}catch(e){result.attendanceRefresh={success:false,error:e.message};}}
    }
    if(result.busy){await call('/rest/v1/bridge_requests?id=eq.'+request.id+'&worker_token=eq.'+lease,{method:'PATCH',body:{status:'queued',worker_token:null,started_at:null}});return;}
    await call('/rest/v1/bridge_requests?id=eq.'+request.id+'&worker_token=eq.'+lease+'&status=eq.processing',{method:'PATCH',body:{status:'completed',result,completed_at:new Date().toISOString()}});
   }catch(error){if(request)try{await call('/rest/v1/bridge_requests?id=eq.'+request.id+'&worker_token=eq.'+lease+'&status=eq.processing',{method:'PATCH',body:{status:'failed',error:error.message,completed_at:new Date().toISOString()}});}catch{}}
   finally{running=false;}
  },10000);timer.unref();return timer;
 }
 return {status,enqueue,job,startWorker};
}
module.exports={createCloudBridge};
