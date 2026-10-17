import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {simulateHubs,cohort} from '../static/hub_logic.js';
const data=JSON.parse(fs.readFileSync(new URL('../data/simulation/hub-inputs.json',import.meta.url)));
test('fixed seed reproduces the same synthetic travelers across policies',()=>{
 assert.deepEqual(cohort(data,50,7),cohort(data,50,7));assert.notDeepEqual(cohort(data,50,7),cohort(data,50,19));
});
test('all people remain accounted for with limited parking, budgets and service',()=>{
 for(const layer of [0,1,2,3])for(const budget of [0,1000,300000]){
  const r=simulateHubs(data,{people:900,layer,budget,hov:3,parkingShare:.01},19);
  assert.equal(Object.values(r.modes).reduce((a,b)=>a+b,0),900);assert.equal(r.completed+r.unserved,900);
  assert.ok(r.budgetUsed<=budget);assert.equal(r.parkingCost+r.poolCost,r.budgetUsed);
  for(const h of r.hubs)assert.ok(h.parked<=h.spaces&&h.spaces<=h.total);
  assert.equal(r.carVehicles,r.modes.car+r.modes.pool/3);
 }
});
test('closed parking allocation and zero rail quota cannot manufacture BRT riders',()=>{
 const r=simulateHubs(data,{people:500,layer:3,parkingShare:0,feederQuota:0,poolSubsidy:0});
 assert.equal(r.modes.park,0);assert.equal(r.modes.feeder,0);assert.equal(r.carVehicles,500);
});
test('no app participants means no attributed voluntary switching or subsidy',()=>{
 const r=simulateHubs(data,{people:500,appShare:0});assert.equal(r.carVehicles,500);assert.equal(r.budgetUsed,0);
});
test('HOV gates retain deferred drivers; peak traffic reduction is not total car reduction',()=>{
 const a=simulateHubs(data,{people:1000,appShare:0,hov:0}),b=simulateHubs(data,{people:1000,appShare:0,hov:3});
 assert.equal(a.carVehicles,b.carVehicles);assert.ok(b.deferred>0);assert.ok(b.peakCarVehicles<a.peakCarVehicles);assert.ok(b.meanMinutes>a.meanMinutes);
});
test('tiny BRT capacity and tiny road capacity preserve unfinished trips',()=>{
 const r=simulateHubs(data,{people:6000,poolSubsidy:0,appShare:1,parkingShare:1,parkingSubsidy:400,busCapacity:1,headway:30,capacityScale:.02});
 assert.ok(r.unserved>0);assert.equal(r.completed+r.unserved,6000);assert.ok(r.hubs.some(h=>h.unserved>0));
});
test('disabling a hub removes its allocation and planned fleet',()=>{
 const r=simulateHubs(data,{people:1000,enabledHubs:['flower'],layer:2});assert.equal(r.hubs.length,1);assert.equal(r.hubs[0].id,'flower');
 assert.throws(()=>simulateHubs(data,{enabledHubs:['unknown']}));
});
test('invalid input and empty cohorts are handled explicitly',()=>{
 for(const options of [{people:-1},{people:1.5},{parkingShare:1.1},{hov:4},{headway:0},{busCapacity:0},{budget:-1},{capacityScale:0},{appShare:NaN}])assert.throws(()=>simulateHubs(data,options));
 const r=simulateHubs(data,{people:0});assert.equal(r.completed,0);assert.equal(r.meanMinutes,0);assert.equal(r.budgetUsed,0);
});
test('subsidies are paid per parked vehicle or matched car, never per passenger',()=>{
 const r=simulateHubs(data,{people:1000,parkingSubsidy:600,parkingPrice:400,poolSubsidy:300,budget:1000000,hov:2});
 assert.equal(r.parkingCost,r.modes.park*400);assert.equal(r.poolCost,r.modes.pool/2*120);
});
test('published scenarios bind to the exact inputs and algorithm and retain all travelers',async()=>{
 const {createHash}=await import('node:crypto'),hash=x=>createHash('sha256').update(x).digest('hex');
 const output=JSON.parse(fs.readFileSync(new URL('../data/simulation/hub-results.json',import.meta.url)));
 assert.equal(output.input_sha256,hash(fs.readFileSync(new URL('../data/simulation/hub-inputs.json',import.meta.url))));
 assert.equal(output.model_sha256,hash(fs.readFileSync(new URL('../static/hub_logic.js',import.meta.url))));
 assert.equal(output.sensitivity.length,144);
 for(const c of output.scenarios){assert.deepEqual(c.result,simulateHubs(data,c.result.options,c.result.seed));assert.equal(c.result.completed+c.result.unserved,c.result.people);}
});
