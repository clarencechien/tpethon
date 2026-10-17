import fs from 'node:fs';import crypto from 'node:crypto';import {runRepairs} from '../static/repair_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),raw=read('data/simulation/hub-inputs.json'),data=JSON.parse(raw);
const strip=r=>({...r,results:r.results.map(({bookings,...rest})=>rest)}),reference=strip(runRepairs(data)),candidate=strip(runRepairs(data,{busSpeed:35,maxExtra:5})),stress=[];
for(const [busSpeed,maxExtra] of [[25,0],[35,5]])for(const actualSpeedFactor of [1,.85,.7])for(const accessDelay of [0,5])for(const eligibilityLeak of [0,.1])for(const seed of [7,19,41]){
 const r=runRepairs(data,{busSpeed,maxExtra,actualSpeedFactor,accessDelay,eligibilityLeak},seed);
 for(const p of r.results.slice(1)){const {bookings,lines,...summary}=p;stress.push({busSpeed,maxExtra,actualSpeedFactor,accessDelay,eligibilityLeak,seed,...summary});}
}
const result={schema_version:1,generated_at:new Date().toISOString(),input_sha256:sha(raw),model_sha256:sha(read('static/repair_logic.js')),cohort_model_sha256:sha(read('static/alternatives_logic.js')),reference,candidate,stress};
fs.writeFileSync(new URL('data/simulation/repair-results.json',root),JSON.stringify(result)+'\n');
console.log(JSON.stringify(reference.results.map(({id,convertedCars,directCars,proxyCarKm,late,newlyLate,unserved,fleetUsed,meetsIllustrativeThreshold})=>({id,convertedCars,directCars,proxyCarKm,late,newlyLate,unserved,fleetUsed,meetsIllustrativeThreshold})),null,2));console.log('Stress conditions',stress.length/5,'policy results',stress.length);
