const DAY=86400000;
const dayFormat=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'});
const dayKey=value=>dayFormat.format(new Date(value));
function validDate(value){return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
function reportRange(from,to,now=new Date(),fallbackDays=30){
  const today=dayKey(now);
  if(Boolean(from)!==Boolean(to))throw Object.assign(new Error('Choose both a start and end date.'),{status:400});
  if(from&&(!validDate(from)||!validDate(to)||from>to||to>today))throw Object.assign(new Error('Choose valid dates, ending today or earlier.'),{status:400});
  const endDate=to||today;
  const endStart=new Date(endDate+'T00:00:00+05:30');
  const startDate=from||dayKey(new Date(endStart.getTime()-(fallbackDays-1)*DAY));
  const days=Math.round((endStart-new Date(startDate+'T00:00:00+05:30'))/DAY)+1;
  if(days>3660)throw Object.assign(new Error('Choose a date range of 10 years or less.'),{status:400});
  return{from:startDate,to:endDate,days,start:new Date(startDate+'T00:00:00+05:30'),end:new Date(Math.min(endStart.getTime()+DAY,now.getTime()+1)),asOf:endDate};
}
function packageGroup(membership,plan={}){
  const name=String(plan.name||membership.plan_name||'').toLowerCase();
  if(plan.code==='custom'||/custom|customiz|personalized/.test(name))return'custom';
  if(!validDate(membership.start_date)||!validDate(membership.end_date))return'custom';
  const start=new Date(membership.start_date+'T00:00:00Z'),end=new Date(membership.end_date+'T00:00:00Z');
  const days=Math.round((end-start)/DAY);
  for(const [code,months] of [['30',1],['90',3],['180',6],['365',12]]){
    // Existing forms use fixed-day packages; also accept exact calendar months.
    if(days===Number(code))return code;
    const target=new Date(start);target.setUTCDate(1);target.setUTCMonth(target.getUTCMonth()+months);
    const lastDay=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();
    target.setUTCDate(Math.min(start.getUTCDate(),lastDay));
    if(target.getTime()===end.getTime())return code;
  }
  return'custom';
}
function collectionChannel(mode){
  const value=String(mode||'').trim().toLowerCase();
  if(value==='cash')return'cash';
  if(/upi|online|card|bank|gpay|google pay|phonepe|paytm|neft|rtgs|imps/.test(value))return'online';
  return'other';
}
module.exports={dayKey,validDate,reportRange,packageGroup,collectionChannel};
