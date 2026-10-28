const {test}=require('node:test');const assert=require('node:assert/strict');const {memberParameters,cashbookEntry}=require('./memberParameters');
test('parameters retain missing demographics and count confirmed renewal transactions in the selected range',()=>{
 const data={members:[{id:'m',full_name:'Sumit Varane',admission_id:'ZF-660',gender:'Male',category:'Regular'},{id:'f',gender:'female'},{id:'u',gender:null},{id:'archived',gender:'Male',is_archived:true}],privateDetails:[{member_id:'m',address:'Hanuman Nagar'},{member_id:'f',address:'Near Kalamba'}],
 memberships:[{id:'p',member_id:'m',kind:'admission',status:'confirmed',start_date:'2026-10-01'}, {id:'r',member_id:'f',kind:'renewal',status:'confirmed',start_date:'2026-10-01',plan_id:'plan'}, {member_id:'m',kind:'renewal',status:'cancelled',start_date:'2026-10-01'}, {member_id:'m',kind:'renewal',status:'confirmed',start_date:'2026-09-01'}],plans:[{id:'plan',name:'1 Month'}]};
 const result=memberParameters(data,{from:'2026-10-01',to:'2026-10-28'});
 assert.deepEqual(result.memberGender,[{label:'Male',count:1},{label:'Female',count:1},{label:'Not recorded',count:1}]);
 assert.equal(result.renewalGender.find(x=>x.label==='Female').count,1);assert.equal(result.renewalGender.find(x=>x.label==='Male').count,0);
 assert.deepEqual(result.areas,[{label:'Hanuman Nagar',count:1},{label:'Kalamba',count:1},{label:'Not recorded',count:1}]);
 assert.equal(cashbookEntry({membership_id:'p'},data).description,'New Admission - Regular - Sumit Varane (ZF-660)');
 assert.equal(cashbookEntry({membership_id:'r'},data).description.startsWith('Renewal - 1 Month - '),true);
 assert.equal(cashbookEntry({source:'cashbook',description:'Existing imported description'},data).description,'Existing imported description');
});
test('parameter status and period filters distinguish member admissions from renewal transactions',()=>{
 const data={members:[{id:'old',gender:'Male',created_at:'2020-01-01T00:00:00Z'},{id:'new',gender:'Female',created_at:'2026-10-10T00:00:00Z'}],memberships:[{member_id:'old',kind:'renewal',status:'confirmed',start_date:'2026-10-01',end_date:'2026-11-30'},{member_id:'new',kind:'renewal',status:'confirmed',start_date:'2026-10-11',end_date:'2026-10-15'}]};
 const range={from:'2026-10-01',to:'2026-10-28'};
 const active=memberParameters(data,range,{period:'custom',status:'active'});
 assert.equal(active.memberGender.reduce((s,v)=>s+v.count,0),0,'old active member was admitted before selected admission period');
 assert.equal(active.renewalGender.find(v=>v.label==='Male').count,1,'their renewal within the selected period still counts');
 const inactive=memberParameters(data,range,{period:'custom',status:'inactive'});
 assert.equal(inactive.memberGender.find(v=>v.label==='Female').count,1);assert.equal(inactive.renewalGender.find(v=>v.label==='Female').count,1);
 const all=memberParameters(data,{from:null,to:'2026-10-28'},{period:'all',status:'active',allTime:true});
 assert.equal(all.memberGender.find(v=>v.label==='Male').count,1);assert.equal(all.memberGender.find(v=>v.label==='Female').count,0);
 const {parameterFilter}=require('./memberParameters');assert.equal(parameterFilter({},new Date('2026-10-28T10:00:00Z')).allTime,true);
 assert.throws(()=>parameterFilter({parameterPeriod:'custom',parameterFrom:'2026-11-01',parameterTo:'2026-10-28'},new Date('2026-10-28T10:00:00Z')),e=>e.status===400);
});
