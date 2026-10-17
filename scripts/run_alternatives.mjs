import fs from 'node:fs';
import crypto from 'node:crypto';
import {compareAlternatives} from '../static/alternatives_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),sha=x=>crypto.createHash('sha256').update(x).digest('hex');
const raw=read('data/simulation/hub-inputs.json'),inputs=JSON.parse(raw),reference=compareAlternatives(inputs),sensitivity=[];
for(const participation of [.1,.5])for(const leakage of [0,.3,.6])for(const parkingShare of [.1,.3])for(const fleet of [8,24])for(const seed of [7,19,41]){
 const trial=compareAlternatives(inputs,{participation,leakage,parkingShare,fleet},seed),base=trial.results[0];
 for(const r of trial.results.slice(1))sensitivity.push({participation,leakage,parkingShare,fleet,seed,id:r.id,directCars:r.directCars,carTripChange:r.carTrips-base.carTrips,carKmChange:r.proxyCarKm-base.proxyCarKm,induced:r.inducedCarTrips,unserved:r.unserved,meanChange:r.meanMinutes===null||base.meanMinutes===null?null:r.meanMinutes-base.meanMinutes,observedPersonMinutesChange:r.observedPersonMinutes-base.observedPersonMinutes});
}
const out={schema_version:1,generated_at:new Date().toISOString(),input_sha256:sha(raw),model_sha256:sha(read('static/alternatives_logic.js')),reference,sensitivity};
fs.writeFileSync(new URL('data/simulation/alternatives-results.json',root),JSON.stringify(out)+'\n');
console.log(JSON.stringify(reference.results.map(({id,directCars,carTrips,proxyCarKm,inducedCarTrips,unserved,meanMinutes})=>({id,directCars,carTrips,proxyCarKm,inducedCarTrips,unserved,meanMinutes})),null,2));
console.log('Parameter combinations:',sensitivity.length/4,'policy results:',sensitivity.length);
