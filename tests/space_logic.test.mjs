import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {spaceDefaults,planSpace,vehicleState,simulateSpace,assessSpace,serviceEnvelope} from '../static/space_logic.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const day=[{day:'one',stations:[{name:'A',hourly:[60,0,0]}]}];
test('finite layover gates the timetable even if unlimited extra buses are offered',()=>{
 const r=planSpace();assert.equal(r.headway,10.5);assert.equal(r.activeFleet,4);assert.equal(r.peakRest,1);assert.equal(r.offsiteParking,18);
 assert.equal(planSpace({fleet:60}).headway,10.5);
 assert.equal(planSpace({berths:2}).headway,10.5);
});
test('waiting for the next scheduled departure also occupies a layover bay',()=>{
 const a={...spaceDefaults,restSpaces:2},p=planSpace(a);
 assert.equal(p.headway,6);assert.equal(p.activeFleet,7);assert.equal(p.padding,0);
 // A naive rest/h limit admits h=5, but ceil(42/5)*5=45: 13 min bay occupation needs 3 spaces.
 const h5cycle=Math.ceil(42/5)*5;assert.equal(Math.ceil((10+h5cycle-42)/5),3);
});
test('berths, rest and external parking preserve every offered bus through a full periodic cycle',()=>{
 for(const opts of [{},{restSpaces:6},{restSpaces:6,extra:10},{restSpaces:6,dwell:4,berths:2},{restSpaces:0}]){
  const a={...spaceDefaults,...opts},p=planSpace(a);let peakBerths=0,peakRest=0;
  for(let t=0;t<(p.cycle||60);t+=.5){
   const s=vehicleState(p,a,t);assert.equal(s.boarding+s.road+s.resting+p.offsiteParking,a.fleet+a.reserve);
   assert.ok(s.boarding<=a.berths);assert.ok(s.resting<=a.restSpaces);peakBerths=Math.max(peakBerths,s.boarding);peakRest=Math.max(peakRest,s.resting);
  }
  if(p.feasible){assert.equal(peakBerths,p.peakBerths);assert.equal(peakRest,p.peakRest);}
 }
});
test('remote deadheading consumes cycle time and longer boarding can become the bottleneck',()=>{
 const local=planSpace({restSpaces:6}),remote=planSpace({restSpaces:6,extra:10});
 assert.deepEqual(planSpace({restSpaces:5}),local);
 assert.equal(local.headway,2.5);assert.equal(remote.headway,3);assert.ok(remote.capacityPerHour<local.capacityPerHour);
 assert.equal(planSpace({restSpaces:6,dwell:4}).headway,4);
 assert.equal(planSpace({restSpaces:6,dwell:4,berths:2}).headway,2.5);
});
test('hand case: delayed six-person bursts wait for the next opening plus two minutes boarding',()=>{
 const r=simulateSpace(day[0].stations[0],{share:1,desiredHeadway:6,restSpaces:2,arrivalPhase:.5});
 near(r.demand,60);near(r.departed,60);near(r.unserved,0);near(r.meanWait,7.5);near(r.p95Wait,7.5);
});
test('passengers still boarding at cutoff remain unserved; zero buses do not erase demand',()=>{
 const station={name:'A',hourly:[0,0,60]};
 const r=simulateSpace(station,{share:1,restSpaces:6,desiredHeadway:1,arrivalPhase:2.5,dwell:4,berths:2,tail:0});
 near(r.demand,r.departed+r.waiting+r.inBoarding);assert.ok(r.inBoarding>0);
 assert.equal(r.unserved,r.waiting+r.inBoarding);
 const none=simulateSpace(station,{share:1,fleet:0});near(none.unserved,60);assert.equal(none.p95Wait,null);
 const zero=simulateSpace(station,{share:0});near(zero.departed+zero.unserved,0);assert.equal(zero.meanWait,null);
});
test('every burst phase conserves people, including unserved, without relying on rounded display',()=>{
 for(let arrivalPhase=0;arrivalPhase<6;arrivalPhase+=.5){
  const r=simulateSpace({name:'A',hourly:[1234,5678,4321]},{arrivalPhase,share:.3});
  near(r.demand,r.departed+r.unserved);assert.ok(r.unserved>0);assert.ok(r.p95Wait>10);
 }
});
test('invalid counts, times, duplicate stations and missing input fail closed',()=>{
 for(const options of [{restSpaces:-1},{berths:.5},{extra:3},{dwell:0},{share:NaN},{roundTrip:5.1},{arrivalPhase:6}])assert.throws(()=>planSpace(options));
 assert.throws(()=>simulateSpace({name:'A',hourly:[null,1,2]}));
 assert.throws(()=>assessSpace([]));
 assert.throws(()=>assessSpace([{day:'bad',stations:[day[0].stations[0],day[0].stations[0]]}]));
 assert.throws(()=>assessSpace([...day,{day:'missing',stations:[]}]));
});
test('service envelope does not call failure at five percent zero transport capacity',()=>{
 const result=serviceEnvelope(day,{fleet:0},[.05,.1]);assert.equal(result.highestTestedShare,null);assert.equal(result.shares.length,2);
 assert.ok(result.shares.every(r=>!r.passed));
});
test('published field scenarios reproduce and bind to exact input and algorithms',()=>{
 const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url));const hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const out=JSON.parse(read('data/simulation/space-experiment.json')),input=JSON.parse(read('data/simulation/service-inputs.json'));
 assert.equal(out.input_sha256,hash(read('data/simulation/service-inputs.json')));
 for(const [name,digest] of Object.entries(out.model_sha256))assert.equal(digest,hash(read('static/'+name)));
 assert.equal(out.cases.length,8);
 const one=out.cases.find(c=>c.id==='one'),two=out.cases.find(c=>c.id==='two'),six=out.cases.find(c=>c.id==='six');
 assert.deepEqual(assessSpace(input.metro.daily,one),one.result);
 assert.equal(one.result.passedDays,0);assert.equal(two.result.passedDays,2);assert.equal(six.result.passedDays,22);
 assert.equal(six.envelope.highestTestedShare,.2);
});
