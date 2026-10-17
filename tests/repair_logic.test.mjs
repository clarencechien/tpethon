import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import crypto from 'node:crypto';
import {runRepairs,departures} from '../static/repair_logic.js';
const raw=fs.readFileSync(new URL('../data/simulation/hub-inputs.json',import.meta.url)),inputs=JSON.parse(raw),candidate={busSpeed:35,maxExtra:5};
test('all original travelers retained, deadlines paired, resources finite',()=>{
 const out=runRepairs(inputs,candidate);
 for(const r of out.results){assert.equal(r.people,2000);assert.equal(r.completed+r.unserved,2000);assert.equal(Object.values(r.modes).reduce((a,b)=>a+b,0),2000);assert.equal(r.late,r.baselineLate+r.newlyLate-r.recovered);assert.ok(r.actualFleetUsed<=r.fleetUsed&&r.fleetUsed<=16);assert.ok(r.parked<=558);assert.ok(r.subsidyCost<=200000);assert.ok(r.railUsed<=600);assert.equal(r.carTrips,r.directCars+r.parked);for(const l of r.lines){assert.equal(l.served+l.unserved,l.booked);assert.ok(l.served<=l.departures*60);}}
});
test('booking checks cover actual seat slots, original estimate and deadline',()=>{
 const out=runRepairs(inputs,candidate);
 for(const r of out.results.filter(r=>['guarded','allocated','reserved','buffered'].includes(r.id))){const slots=new Map(),margin=r.id==='buffered'?5:0;assert.equal(new Set(r.bookings.map(b=>b.id)).size,r.bookings.length);for(const b of r.bookings){assert.ok(b.plannedFinish+margin<=150+1e-8);assert.ok(b.plannedFinish+margin<=b.baselineFinish+5+1e-8);const key=b.line+':'+b.trip;slots.set(key,(slots.get(key)||0)+1);}for(const n of slots.values())assert.ok(n<=60);assert.equal(r.newlyLate,0);}
});
test('no passenger service is not counted as an improvement',()=>{
 const r=runRepairs(inputs).results.find(r=>r.id==='reserved');assert.equal(r.convertedCars,0);assert.equal(r.fleetUsed,0);assert.equal(r.newlyLate,0);assert.equal(r.meetsIllustrativeThreshold,false);
});
test('cancelling empty runs retains bookings and reduces incremental bus distance',()=>{
 const out=runRepairs(inputs,candidate),a=out.results.find(r=>r.id==='allocated'),r=out.results.find(r=>r.id==='reserved');assert.deepEqual(r.bookings,a.bookings);assert.equal(r.convertedCars,55);assert.equal(r.newlyLate,0);assert.equal(r.unserved,0);assert.ok(r.proxyBusKm<a.proxyBusKm);assert.ok(a.modeledRoadKmChange>0);assert.ok(r.modeledRoadKmChange<0);assert.equal(a.meetsIllustrativeThreshold,false);assert.equal(r.meetsIllustrativeThreshold,true);
});
test('stress delays never leak into planning and can invalidate nominal success',()=>{
 const nominal=runRepairs(inputs,candidate),stress=runRepairs(inputs,{...candidate,actualSpeedFactor:.85,accessDelay:5});for(const id of ['guarded','allocated','reserved','buffered']){const a=nominal.results.find(r=>r.id===id),b=stress.results.find(r=>r.id===id);assert.deepEqual(b.bookings,a.bookings);assert.equal(b.fleetUsed,a.fleetUsed);}
 const r=stress.results.find(r=>r.id==='reserved');assert.ok(r.newlyLate>0);assert.equal(r.meetsIllustrativeThreshold,false);
});
test('zero fleet rejects guarded reservations rather than stranding accepted riders',()=>{
 const out=runRepairs(inputs,{...candidate,fleet:0});for(const r of out.results.filter(r=>['guarded','allocated','reserved','buffered'].includes(r.id))){assert.equal(r.accepted,0);assert.equal(r.unserved,0);assert.equal(r.newlyLate,0);assert.equal(r.fleetUsed,0);}assert.ok(out.results.find(r=>r.id==='eligibility').unserved>0);
});
test('zero parking and budget do not prevent rail or express offers, do forbid parking',()=>{
 for(const extra of [{parkingShare:0},{budget:0}]){const out=runRepairs(inputs,{...candidate,...extra});for(const r of out.results){assert.equal(r.parked,0);assert.equal(r.subsidyCost,0);}assert.ok(out.results.find(r=>r.id==='reserved').accepted>0);}
});
test('eligibility errors are explicit, not erased by changing labels',()=>{
 const out=runRepairs(inputs,{eligibilityLeak:.1}),r=out.results.find(r=>r.id==='eligibility');assert.ok(r.inducedCarTrips>0);assert.equal(r.carTrips,1200+r.inducedCarTrips);assert.equal(r.meetsIllustrativeThreshold,false);
});
test('empty cohort and invalid parameters',()=>{
 for(const r of runRepairs(inputs,{carPeople:0,transitPeople:0}).results){assert.equal(r.meanMinutes,null);assert.equal(r.fleetUsed,0);assert.equal(r.meetsIllustrativeThreshold,false);}
 for(const o of [{fleet:-1},{actualSpeedFactor:0},{eligibilityLeak:2},{deadline:301},{carPeople:1.5},{buffer:NaN}])assert.throws(()=>runRepairs(inputs,o));
 const d=departures(20,1,{busSpeed:25,headway:10});assert.ok(d.times.every((t,i)=>!i||t-d.times[i-1]>=d.cycle-1e-8));
});
test('published source hashes, nominal results and all stress summaries reproduce',()=>{
 const archive=JSON.parse(fs.readFileSync(new URL('../data/simulation/repair-results.json',import.meta.url))),sha=b=>crypto.createHash('sha256').update(b).digest('hex');assert.equal(archive.input_sha256,sha(raw));assert.equal(archive.model_sha256,sha(fs.readFileSync(new URL('../static/repair_logic.js',import.meta.url))));assert.equal(archive.cohort_model_sha256,sha(fs.readFileSync(new URL('../static/alternatives_logic.js',import.meta.url))));
 const strip=r=>({...r,results:r.results.map(({bookings,...rest})=>rest)});assert.deepEqual(archive.reference,strip(runRepairs(inputs)));assert.deepEqual(archive.candidate,strip(runRepairs(inputs,candidate)));assert.equal(archive.stress.length,360);
 const groups=new Map();for(const row of archive.stress){const k=JSON.stringify([row.busSpeed,row.maxExtra,row.actualSpeedFactor,row.accessDelay,row.eligibilityLeak,row.seed]);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}assert.equal(groups.size,72);
 for(const [key,rows]of groups){const [busSpeed,maxExtra,actualSpeedFactor,accessDelay,eligibilityLeak,seed]=JSON.parse(key),out=runRepairs(inputs,{busSpeed,maxExtra,actualSpeedFactor,accessDelay,eligibilityLeak},seed);assert.equal(rows.length,5);for(const row of rows){const {bookings,lines,...summary}=out.results.find(r=>r.id===row.id);assert.deepEqual(row,{busSpeed,maxExtra,actualSpeedFactor,accessDelay,eligibilityLeak,seed,...summary});}}
});
