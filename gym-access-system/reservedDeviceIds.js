const ZENITH_GYM_ID='b80cd818-2abe-4a90-9027-e2ba1916aec4';
const TEAM_ZENITH=[
 [2985,'Hemant Patil (TZ)'],[2986,'Arif Shaikh (TZ)'],[2987,'Lakhan (TZ)'],
 [2988,'Sonali/Sakshi (TZ)'],[2989,'Atharva Sardesai (TZ)'],[2990,'Sandeep Dhawale (TZ)'],
 [2991,'Shilpa Patil (TZ)'],[2992,'Tushar Redekar (TZ)'],[2993,'Swati Maushi'],
 [2994,'Sangita Maushi'],[2995,'Rajvira Patil(TZ)'],[2996,'Rajvardhan Patil']
];
function reservedDevices(snapshot){
 const base=snapshot.gym_id===ZENITH_GYM_ID?TEAM_ZENITH.map(([device_user_id,full_name])=>({device_user_id,full_name,admission_id:'ZF-'+device_user_id})):[];
 const devices=new Map(base.map(m=>[Number(m.device_user_id),m]));
 for(const m of snapshot.reserved_devices||[])devices.set(Number(m.device_user_id),m);
 return devices;
}
function isReservedMember(member,reserved){return reserved.has(Number(member.device_user_id))||reserved.has(Number(String(member.admission_id||'').match(/^ZF-(\d+)$/)?.[1]));}
module.exports={TEAM_ZENITH,ZENITH_GYM_ID,reservedDevices,isReservedMember};
