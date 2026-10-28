const {test}=require('node:test');const assert=require('node:assert/strict');
const {endDate,update}=require('../package-dates');
test('custom days calculate correctly across months, years and leap days',()=>{
 assert.equal(endDate('2026-10-28',45),'2026-12-12');
 assert.equal(endDate('2026-12-31',1),'2027-01-01');
 assert.equal(endDate('2028-02-28',1),'2028-02-29');
 for(const days of [0,-1,1.5,NaN,Infinity])assert.equal(endDate('2026-10-28',days),'');
 assert.equal(endDate('2026-02-30',10),'');
});
test('custom duration is required only for custom plans and recalculates when start or days change',()=>{
 const plan={value:'custom',disabled:false},start={value:'2026-10-28'},end={},days={value:'45',setCustomValidity(value){this.error=value;}},container={};
 update(plan,start,end,days,container);assert.equal(end.value,'2026-12-12');assert.equal(days.required,true);assert.equal(container.hidden,false);assert.equal(end.readOnly,true);
 days.value='10';start.value='2026-11-01';update(plan,start,end,days,container);assert.equal(end.value,'2026-11-11');
 days.value='1.5';update(plan,start,end,days,container);assert.equal(end.value,'');assert.ok(days.error);
 plan.value='30';update(plan,start,end,days,container);assert.equal(end.value,'2026-12-01');assert.equal(container.hidden,true);assert.equal(days.required,false);assert.equal(days.disabled,true);assert.equal(end.readOnly,false);
 plan.value='custom';plan.disabled=true;update(plan,start,end,days,container);assert.equal(days.disabled,true);
});
