import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {simulateStation} from '../static/service_logic.js';
import {arrivalPhases,assessFleet,robustFleet} from '../static/fleet_logic.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const station={name:'A',hourly:[60,0,0]},days=[{day:'test',stations:[station]}];
test('bursts preserve each hourly cohort for every half-minute phase',()=>{
 for(const arrivalInterval of [3,6])for(const arrivalPhase of arrivalPhases(arrivalInterval)){
  const r=simulateStation({name:'A',hourly:[123,456,789]},{share:.3,arrivalInterval,arrivalPhase,capacity:20,fleet:1,tail:0});
  near(r.demand,.3*(123+456+789));near(r.boarded+r.unserved,r.demand);assert.ok(r.unserved>0);
 }
});
test('independent hand case: ten six-person batches miss ten departures by half a minute',()=>{
 const a={share:1,capacity:10,load:1,headway:6,fleet:1,travelLag:0,roundTrip:1,rest:0,arrivalInterval:6};
 const aligned=simulateStation(station,{...a,arrivalPhase:0});near(aligned.meanWait,0);near(aligned.boarded,60);
 const missed=simulateStation(station,{...a,arrivalPhase:.5});near(missed.meanWait,5.5);near(missed.p95Wait,5.5);near(missed.passengerWaitHours,5.5);near(missed.lastBoarding,60);near(missed.unserved,0);
});
test('invalid burst intervals and phases cannot quietly drop demand',()=>{
 for(const opts of [{arrivalInterval:7},{arrivalInterval:6,arrivalPhase:6},{arrivalInterval:3,arrivalPhase:.2},{arrivalInterval:0,arrivalPhase:.5}])assert.throws(()=>simulateStation(station,opts));
 assert.throws(()=>arrivalPhases(7));
});
test('one fixed fleet passes every day and phase, never daily fleet pooling',()=>{
 const d=[{day:'small',stations:[station]},{day:'large',stations:[{name:'A',hourly:[600,1200,300]}]}];
 const result=robustFleet(d,{share:1,arrivalInterval:6});assert.ok(result.feasible);assert.equal(result.passedDays,2);assert.equal(result.phases.length,12);
 const checked=assessFleet(d,result.stations,{share:1,arrivalInterval:6});assert.deepEqual(checked,result);
 assert.equal(assessFleet(d,[{station:'A',headway:3,activeFleet:0}],{share:1}).feasible,false);
});
test('missing days, duplicate station names and infeasible demand fail explicitly',()=>{
 assert.throws(()=>robustFleet([]));
 assert.throws(()=>assessFleet(days,[{station:'B',headway:3,activeFleet:14}]));
 assert.throws(()=>assessFleet(days,[{station:'A',headway:3,activeFleet:14},{station:'A',headway:3,activeFleet:14}]));
 const r=robustFleet([{day:'huge',stations:[{name:'A',hourly:[1e6,1e6,1e6]}]}],{share:1});assert.equal(r.feasible,false);assert.equal(r.totalFleet,null);
});
test('a zero-demand plan needs no vehicles and makes no fabricated wait statistic',()=>{
 const r=robustFleet(days,{share:0});assert.equal(r.totalFleet,0);assert.equal(r.stations[0].worstP95,null);
});
test('published results tie to input and model checksums and retain fixed baseline',()=>{
 const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
 const artifact=JSON.parse(read('data/simulation/fleet-experiment.json'));
 assert.equal(artifact.cells.length,60);assert.equal(artifact.input_sha256,hash(read('data/simulation/service-inputs.json')));
 for(const [name,digest] of Object.entries(artifact.model_sha256))assert.equal(digest,hash(read('static/'+name)));
 const base=artifact.cells.find(c=>c.share===.2&&c.roundTrip===30&&c.arrivalInterval===0);
 const burst=artifact.cells.find(c=>c.share===.2&&c.roundTrip===30&&c.arrivalInterval===6);
 assert.equal(base.recommended.totalFleet,38);assert.equal(burst.recommended.totalFleet,44);assert.equal(burst.baseline.passedDays,17);
 const input=JSON.parse(read('data/simulation/service-inputs.json'));
 assert.deepEqual(robustFleet(input.metro.daily,{share:.2,roundTrip:30,arrivalInterval:6}),burst.recommended);
 for(const c of artifact.cells){
  assert.equal(c.baseline.totalFleet,38);
  if(c.recommended.feasible){assert.equal(c.recommended.passedDays,22);for(const s of c.recommended.stations){assert.equal(s.maxMissed,0);near(s.maxUnserved,0);assert.ok(s.worstP95<=10);}}
 }
});
