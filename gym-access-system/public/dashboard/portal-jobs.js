(function(root){
 async function awaitBridge(jobId,{fetchImpl=fetch,sleep=ms=>new Promise(r=>setTimeout(r,ms)),now=Date.now,timeoutMs=31*60000}={}){
  const deadline=now()+timeoutMs;
  while(now()<deadline){
   const response=await fetchImpl('/api/portal/bridge-jobs/'+encodeURIComponent(jobId),{headers:{'Content-Type':'application/json'},cache:'no-store'});
   const job=await response.json();if(!response.ok)throw Object.assign(new Error(job.error||'Could not check the gym bridge.'),{status:response.status});
   if(job.status==='completed')return job.result;
   if(job.status==='failed')throw new Error(job.error||'The gym bridge could not finish the request.');
   if(job.expires_at&&new Date(job.expires_at).getTime()<now())throw new Error('The bridge request expired. Check that the gym computer is online and retry.');
   await sleep(2000);
  }
  throw new Error('The gym bridge has not confirmed completion. Check the local app before retrying.');
 }
 if(typeof module==='object'&&module.exports)module.exports={awaitBridge};else root.zenithAwaitBridge=awaitBridge;
})(typeof window!=='undefined'?window:globalThis);
