import fs from 'node:fs';import crypto from 'node:crypto';import{runRailHub}from '../static/rail_hub_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),raw=read('data/simulation/rail-hub-inputs.json'),input=JSON.parse(raw),strip=r=>({...r,results:r.results.map(({bookings,cycles,...s})=>s)}),reference=strip(runRailHub(input)),quota=strip(runRailHub(input,{railSparePerTrain:5})),delayed=strip(runRailHub(input,{railSparePerTrain:5,trainDelay:5,walkDelay:3,actualRideFactor:1.25})),experiments=[];
for(const trainHeadway of [6,10,15])for(const extraFleet of [0,2])for(const railSparePerTrain of [0,5])for(const railMinutes of [20,30,45])for(const delayed of [false,true])for(const seed of [7,19,41]){
 const options={trainHeadway,extraFleet,railSparePerTrain,railMinutes,...(delayed?{trainDelay:5,walkDelay:3,actualRideFactor:1.25}:{trainDelay:0,walkDelay:0,actualRideFactor:1})};experiments.push({options,seed,results:strip(runRailHub(input,options,seed)).results});
}
fs.writeFileSync(new URL('data/simulation/rail-hub-results.json',root),JSON.stringify({schema_version:1,generated_at:new Date().toISOString(),input_sha256:sha(raw),model_sha256:sha(read('static/rail_hub_logic.js')),reference,quota,delayed,experiments})+'\n');
console.log('Conditions',experiments.length,'policy results',experiments.length*4);
for(const r of reference.results)console.log(r.id,'mean',r.railMeanMinutes,'newlate',r.newlyLate,'cost',r.incrementalCost);
for(const id of ['aligned','expanded','rail_shift','priority']){const rows=experiments.map(e=>e.results.find(r=>r.id===id));console.log(id,'service',rows.filter(r=>r.serviceScreen).length,'car',rows.filter(r=>r.carScreen).length,'/',rows.length);}
