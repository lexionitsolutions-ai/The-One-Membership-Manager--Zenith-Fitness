const {test}=require('node:test');const assert=require('node:assert/strict');const {buildDashboard}=require('./dashboardMetrics');
const now=new Date('2026-11-01T02:00:00Z');
const period=(id,kind,purchased_at,amount=2000,extra={})=>({id,member_id:'m',kind,status:'confirmed',start_date:'2026-11-01',end_date:'2026-12-01',purchased_at,final_amount:amount,...extra});
const data={members:[{id:'m',full_name:'Example'}],memberships:[period('old','admission','2026-10-31T18:29:59Z'),period('new','admission','2026-10-31T18:30:00Z',4500,{start_date:'2026-12-01',end_date:'2027-01-01'}),period('renew','renewal','2026-11-01T01:00:00Z',null,{historical_charge:3500}),period('cancel','admission','2026-11-01T01:00:00Z',9000,{status:'cancelled'}),period('future','renewal','2026-11-01T03:00:00Z'),period('fallback','renewal',null,1000)],payments:[{amount:8000,kind:'payment',paid_at:'2026-11-01T01:00:00Z'}]};
test('monthly goals use India sale date, ignore report range, exclude cancelled/future sales, and never double count payments',()=>{
 const t=buildDashboard(data,{role:'admin',now,from:'2026-10-01',to:'2026-10-31'}).monthlyTarget;
 assert.deepEqual(t,{month:'2026-11',asOf:'2026-11-01',salesGoal:500000,renewalsGoal:60,admissionsGoal:80,salesAchieved:9000,renewalsAchieved:2,admissionsAchieved:1,salesRemaining:491000,renewalsRemaining:58,admissionsRemaining:79});
});
test('reception sees the same goals and countdown without receiving financial registers; trainers do not receive targets',()=>{
 const admin=buildDashboard(data,{role:'admin',now});const reception=buildDashboard(data,{role:'receptionist',now});assert.deepEqual(reception.monthlyTarget,admin.monthlyTarget);assert.equal(reception.allPayments,undefined);assert.equal(reception.gymOverview.totalCollected,undefined);assert.equal(buildDashboard(data,{role:'trainer',now}).monthlyTarget,undefined);
});
test('goals reset next month and completed countdowns stop at zero',()=>{
 const many={members:data.members,memberships:[...Array.from({length:81},(_,i)=>period('a'+i,'admission','2026-11-01T01:00:00Z',4000)),...Array.from({length:61},(_,i)=>period('r'+i,'renewal','2026-11-01T01:00:00Z',4000))]};
 const t=buildDashboard(many,{role:'admin',now}).monthlyTarget;assert.equal(t.salesAchieved,568000);assert.equal(t.salesRemaining,0);assert.equal(t.renewalsRemaining,0);assert.equal(t.admissionsRemaining,0);
 const next=buildDashboard(many,{role:'admin',now:new Date('2026-11-30T18:30:00Z')}).monthlyTarget;assert.equal(next.month,'2026-12');assert.equal(next.salesRemaining,500000);assert.equal(next.admissionsRemaining,80);assert.equal(next.renewalsRemaining,60);
});
