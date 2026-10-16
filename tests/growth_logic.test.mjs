import test from 'node:test';
import assert from 'node:assert/strict';
import {compound,profileWeights,projectInputs,annualProjection,metroBaseline} from '../static/growth_logic.js';
import {defaults,runScenario} from '../static/simulation_logic.js';
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-6,`${a} != ${b}`);
const profile={duration_minutes:150,step_minutes:15,start_minute:420,days:['2026-10-12','2026-10-13','2026-10-14'],values:[0,1,2,3,4,5,4,3,2,1]};
test('compound growth supports zero, decline, and exact annual compounding',()=>{
 near(compound(10000,.02,5),11040.808032);near(compound(100,-.1,2),81);near(compound(100,.2,0),100);near(compound(0,.1,20),0);
 for(const args of [[100,NaN,5],[100,.3,5],[100,.02,1.5],[-1,.02,5]])assert.throws(()=>compound(...args));
});
test('projection preserves the base and does not compound an already-projected total',()=>{
 const a=projectInputs(defaults,{demandRate:.02,capacityRate:0,years:5});
 assert.equal(a.people,11041);assert.equal(a.innerCapacity,defaults.innerCapacity);assert.equal(defaults.people,10000);
 assert.deepEqual(a,projectInputs(defaults,{demandRate:.02,capacityRate:0,years:5}));
 const rows=annualProjection(defaults,{demandRate:.02,capacityRate:.01,years:5},{bus:.2,stagger:0,restrict:0});
 assert.equal(rows.length,6);assert.equal(rows[0].people,10000);assert.equal(rows[5].people,11041);
 near(rows[5].innerCapacity,defaults.innerCapacity*1.01**5);
});
test('sampled shape preserves zero weights and total modeled demand without treating samples as a total',()=>{
 const weights=profileWeights(profile);assert.equal(weights.length,150);assert.ok(weights.slice(0,15).every(v=>v===0));
 const a=runScenario({...defaults,demandWeights:weights}),b=runScenario({...defaults,demandWeights:weights.map(v=>v*10)});
 near(a.totalPCU,b.totalPCU);near(a.queuePCUHours,b.queuePCUHours);near(a.carPeople,defaults.people);
 assert.equal(a.demandProfileKind,'observed_sample_shape');
});
test('missing/negative profiles cannot become invented demand or a zero-filled curve',()=>{
 for(const change of [{values:[...profile.values.slice(1)]},{values:Array(10).fill(0)},{values:[null,...profile.values.slice(1)]},{days:['2026-10-12']},{values:[-1,...profile.values.slice(1)]}])assert.throws(()=>profileWeights({...profile,...change}));
 assert.throws(()=>runScenario({...defaults,demandWeights:[1,2]}));
});
test('metro baseline uses actual total divided by observed weekdays, independently from road demand',()=>{
 near(metroBaseline({total_journeys:414439,weekdays:22,dates:Array(22).fill('date')}),414439/22);
 assert.throws(()=>metroBaseline({total_journeys:100,weekdays:0,dates:[]}));
});
test('more capacity cannot increase point-queue delay under unchanged demand',()=>{
 const a=runScenario(defaults),b=runScenario(projectInputs(defaults,{demandRate:0,capacityRate:.05,years:5}));
 assert.ok(b.queuePCUHours<=a.queuePCUHours);near(a.people,b.people);
});
