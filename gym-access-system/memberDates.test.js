const {test}=require('node:test');const assert=require('node:assert/strict');
const {format,parse,ageOn}=require('../member-dates');
test('numeric birth dates format with slashes and preserve day/month order for storage',()=>{
 assert.equal(format('07052007'),'07/05/2007');assert.equal(format('07 05 2007'),'07/05/2007');assert.equal(format('07-05-2007'),'07/05/2007');
 assert.equal(format('070'),'07/0');assert.equal(parse('07/05/2007'),'2007-05-07');
 for(const value of ['31/02/2007','29/02/2007','00/05/2007','07/13/2007','07/05/20'])assert.equal(parse(value),'');
 assert.equal(parse('29/02/2008'),'2008-02-29');
});
test('age uses the full birth date, including birthday and future-date boundaries',()=>{
 assert.equal(ageOn('2007-05-07','2026-05-06'),18);assert.equal(ageOn('2007-05-07','2026-05-07'),19);
 assert.equal(ageOn('2007-05-07','2026-10-28'),19);assert.equal(ageOn('2026-10-28','2026-10-28'),0);
 assert.equal(ageOn('2026-10-29','2026-10-28'),null);assert.equal(ageOn('','2026-10-28'),null);
});
