import fs from 'node:fs';
import crypto from 'node:crypto';
import {spaceDefaults,spaceCases,assessSpace,serviceEnvelope} from '../static/space_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const raw=read('data/simulation/service-inputs.json'),data=JSON.parse(raw);
const out={schema_version:1,generated_at:new Date().toISOString(),input_sha256:hash(raw),
 model_sha256:Object.fromEntries(['space_logic.js','service_logic.js','fleet_logic.js'].map(n=>[n,hash(read('static/'+n))])),
 calibrated:false,month:data.metro.month,assumptions:spaceDefaults,cases:[]};
for(const scenario of spaceCases){
 const options={...spaceDefaults,...scenario},result=assessSpace(data.metro.daily,options),envelope=serviceEnvelope(data.metro.daily,options);
 out.cases.push({...scenario,result,envelope});
 console.log(JSON.stringify({id:scenario.id,headway:result.plan.headway,active:result.plan.activeFleet,external:result.plan.offsiteParking,
 passed:result.passedDays,share:envelope.highestTestedShare,unserved:result.stations.map(s=>s.maxUnserved)}));
}
fs.writeFileSync(new URL('data/simulation/space-experiment.json',root),JSON.stringify(out)+'\n');
