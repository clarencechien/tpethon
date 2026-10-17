import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {compareAlternatives} from '../static/alternatives_logic.js';
const raw=fs.readFileSync(new URL('../data/simulation/hub-inputs.json',import.meta.url)),inputs=JSON.parse(raw);
test('same cohort conserved, finite fleet, capacity and budget respected',()=>{
 const out=compareAlternatives(inputs);
 for(const r of out.results){assert.equal(r.completed+r.unserved,2000);assert.equal(Object.values(r.modes).reduce((a,b)=>a+b,0),2000);assert.equal(r.groups.reduce((s,g)=>s+g.people,0),2000);assert.ok(r.fleetUsed<=16);assert.ok(r.subsidyCost<=200000);assert.ok(r.parkingUsed<=r.parkingQuota);assert.equal(r.carTrips,r.directCars+r.parkingUsed);
  for(const l of r.lines){assert.equal(l.served+l.unserved,l.passengers);assert.ok(l.served<=l.departures*60);assert.ok(l.parked<=l.spaces);}
 }
});
test('universal parking can reduce entry cars while increasing car trips and proxy distance',()=>{
 const out=compareAlternatives(inputs),b=out.results[0],p=out.results.find(r=>r.id==='park');assert.ok(p.directCars<b.directCars);assert.ok(p.carTrips>b.carTrips);assert.ok(p.proxyCarKm>b.proxyCarKm);assert.equal(p.inducedCarTrips,p.carTrips-b.carTrips);assert.equal(p.parkingUsed,558);
});
test('zero parking and unfunded subsidy retain original trips instead of deleting people',()=>{
 for(const options of [{parkingShare:0},{budget:0}]){const out=compareAlternatives(inputs,options),b=out.results[0];for(const r of out.results.filter(r=>['park','targeted'].includes(r.id))){assert.equal(r.directCars,b.directCars);assert.equal(r.carTrips,b.carTrips);assert.equal(r.parkingUsed,0);assert.equal(r.meanMinutes,b.meanMinutes);}}
});
test('zero participation and zero induced demand reproduce baseline',()=>{
 const out=compareAlternatives(inputs,{participation:0,leakage:0}),b=out.results[0];for(const r of out.results){assert.equal(r.carTrips,b.carTrips);assert.equal(r.proxyCarKm,b.proxyCarKm);assert.equal(r.meanMinutes,b.meanMinutes);assert.equal(r.fleetUsed,0);}
});
test('zero fleet retains all willing direct bus passengers as unfinished',()=>{
 const r=compareAlternatives(inputs,{fleet:0,participation:1}).results.find(r=>r.id==='express');assert.equal(r.unserved,2000);assert.equal(r.meanMinutes,null);assert.equal(r.p95Minutes,null);assert.equal(r.fleetUsed,0);assert.equal(r.proxyBusKm,0);assert.ok(r.observedPersonMinutes>0);
});
test('no spare rail seats prevents car conversion but does not invent rail capacity',()=>{
 const out=compareAlternatives(inputs,{railQuota:0,transitPeople:0,participation:1}),r=out.results.find(r=>r.id==='rail');assert.equal(r.railUsed,0);assert.equal(r.rejectedRail,1200);assert.equal(r.directCars,1200);assert.equal(r.meanMinutes,out.results[0].meanMinutes);
});
test('targeted eligibility prevents induced cars by assumption, existing transit cohort retained',()=>{
 const r=compareAlternatives(inputs,{leakage:1}).results.find(r=>r.id==='targeted');assert.equal(r.inducedCarTrips,0);assert.equal(r.modes.originalTransit,800);assert.equal(r.carTrips,1200);
});
test('zero people has no fictional average, buses or costs; invalid assumptions rejected',()=>{
 const out=compareAlternatives(inputs,{carPeople:0,transitPeople:0});for(const r of out.results){assert.equal(r.people,0);assert.equal(r.meanMinutes,null);assert.equal(r.fleetUsed,0);assert.equal(r.subsidyCost,0);}
 for(const a of [{fleet:-1},{fleet:1.5},{participation:1.01},{carPeople:NaN},{roadScale:0},{capacity:0},{subsidy:401}])assert.throws(()=>compareAlternatives(inputs,a));
});
test('published results match model and sources and include all 72 parameter combinations',()=>{
 const archive=JSON.parse(fs.readFileSync(new URL('../data/simulation/alternatives-results.json',import.meta.url))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(archive.input_sha256,sha(raw));assert.equal(archive.model_sha256,sha(fs.readFileSync(new URL('../static/alternatives_logic.js',import.meta.url))));assert.deepEqual(archive.reference,compareAlternatives(inputs));assert.equal(archive.sensitivity.length,288);
 const groups=new Map();for(const r of archive.sensitivity){const key=JSON.stringify([r.participation,r.leakage,r.parkingShare,r.fleet,r.seed]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}assert.equal(groups.size,72);
 for(const [key,rows]of groups){const [participation,leakage,parkingShare,fleet,seed]=JSON.parse(key),out=compareAlternatives(inputs,{participation,leakage,parkingShare,fleet},seed),b=out.results[0];assert.equal(rows.length,4);for(const row of rows){const r=out.results.find(r=>r.id===row.id);assert.equal(row.unserved,r.unserved);assert.equal(row.carKmChange,r.proxyCarKm-b.proxyCarKm);assert.equal(row.carTripChange,r.carTrips-b.carTrips);}}
});
