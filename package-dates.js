(function(root){
 function endDate(start,days){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!Number.isSafeInteger(days)||days<=0)return '';
  const date=new Date(start+'T00:00:00Z');
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==start)return '';
  date.setUTCDate(date.getUTCDate()+days);
  if(!Number.isFinite(date.getTime())||date.getUTCFullYear()>9999)return '';
  return date.toISOString().slice(0,10);
 }
 function update(plan,start,end,days,container){
  const custom=plan.value==='custom';container.hidden=!custom;days.disabled=!custom||plan.disabled;days.required=custom;
  end.readOnly=custom;
  const value=endDate(start.value,Number(custom?days.value:plan.value));
  days.setCustomValidity(custom&&days.value&&!value?'Enter a valid positive whole number of days.':'');
  end.value=value;
 }
 const api={endDate,update};if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenithPackageDates=api;
})(typeof window!=='undefined'?window:globalThis);
