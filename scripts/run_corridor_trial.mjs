import fs from 'node:fs';import crypto from 'node:crypto';import {runCorridorTrial} from '../static/corridor_trial_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),sha=x=>crypto.createHash('sha256').update(x).digest('hex'),raw=read('data/simulation/corridor-trial-inputs.json'),input=JSON.parse(raw);
const strip=r=>({...r,results:r.results.map(({bookings,newService,legacy,...s})=>({...s,newService:(({cycles,...v})=>v)(newService),legacy:(({cycles,...v})=>v)(legacy)}))});
const reference=strip(runCorridorTrial(input)),extraSpace=strip(runCorridorTrial(input,{backgroundVph:1000,additionalLane:1})),extraSpaceDelayed=strip(runCorridorTrial(input,{backgroundVph:1000,additionalLane:1,actualSpeedFactor:.85,accessDelay:5})),experiments=[];
for(const carPeople of [300,600,1200])for(const backgroundVph of [300,600,1000])for(const fleet of [2,4,8])for(const additionalLane of [0,1])for(const [actualSpeedFactor,accessDelay]of [[1,0],[.85,5]])for(const seed of [7,19,41]){
 const options={carPeople,backgroundVph,fleet,additionalLane,actualSpeedFactor,accessDelay};
 const result=strip(runCorridorTrial(input,options,seed));experiments.push({options,seed,results:result.results});
}
const out={schema_version:1,generated_at:new Date().toISOString(),input_sha256:sha(raw),model_sha256:sha(read('static/corridor_trial_logic.js')),reference,extraSpace,extraSpaceDelayed,experiments};
fs.writeFileSync(new URL('data/simulation/corridor-trial-results.json',root),JSON.stringify(out)+'\n');console.log('Conditions',experiments.length,'policy results',experiments.length*4);
for(const r of reference.results)console.log(r.id,'converted',r.converted,'newly late',r.newlyLate,'person hours',Math.round(r.personMinutesChange/60),'cost per on time',r.costPerOnTime,'pass',r.screenPass);
for(const id of ['express','hub','brt','brt_hub'])for(const additionalLane of [0,1]){const rows=experiments.filter(e=>e.options.additionalLane===additionalLane).map(e=>e.results.find(r=>r.id===id));console.log(id,'additionalLane',additionalLane,'pass',rows.filter(r=>r.screenPass).length,'/',rows.length);}
