(function(root){
 const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 function format(value){const digits=String(value).replace(/\D/g,'').slice(0,8);return [digits.slice(0,2),digits.slice(2,4),digits.slice(4,8)].filter(Boolean).join('/');}
 function parse(value){
  const match=/^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);if(!match)return '';
  const iso=`${match[3]}-${match[2]}-${match[1]}`,date=new Date(iso+'T00:00:00Z');
  return Number.isFinite(date.getTime())&&date.toISOString().slice(0,10)===iso?iso:'';
 }
 function ageOn(iso,day=today()){
  if(!iso||iso>day)return null;
  const age=Number(day.slice(0,4))-Number(iso.slice(0,4))-(day.slice(5)<iso.slice(5)?1:0);
  return age>=0&&age<=130?age:null;
 }
 const api={format,parse,ageOn,today};if(typeof module==='object'&&module.exports)module.exports=api;else root.ZenithMemberDates=api;
})(typeof window!=='undefined'?window:globalThis);
