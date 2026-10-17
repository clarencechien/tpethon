import fs from 'node:fs';import crypto from 'node:crypto';
import {simulateHubs} from '../static/hub_logic.js';
const root=new URL('../',import.meta.url),raw=fs.readFileSync(new URL('data/simulation/hub-inputs.json',root)),data=JSON.parse(raw),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const cases=[{id:'baseline',label:'參考：全部單人開車',layer:0,parkingSubsidy:0,poolSubsidy:0},
 {id:'near',label:'第一層：花博＋機場轉乘',layer:1,poolSubsidy:0},
 {id:'rail_hubs',label:'第二層：加入四個市區樞紐',layer:2,poolSubsidy:0},
 {id:'pool',label:'第二層＋共乘補助',layer:2},
 {id:'hov',label:'第二層＋共乘＋3人高乘載',layer:2,hov:3},
 {id:'regional',label:'第三層＋假設600人鐵路接駁配額',layer:3,hov:3}];
const scenarios=cases.map(c=>({...c,result:simulateHubs(data,c,7)}));
const sensitivity=[];
for(const parkingShare of [.1,.3])for(const parkingSubsidy of [0,150,300])for(const appShare of [.3,.7])for(const hov of [0,3])for(const capacityScale of [.7,1])for(const seed of [7,19,41]){
 const r=simulateHubs(data,{parkingShare,parkingSubsidy,appShare,hov,capacityScale},seed),base=simulateHubs(data,{layer:0,poolSubsidy:0},seed);
 sensitivity.push({parkingShare,parkingSubsidy,appShare,hov,capacityScale,seed,carReduction:base.carVehicles-r.carVehicles,peakCarReduction:base.peakCarVehicles-r.peakCarVehicles,meanMinutes:r.meanMinutes,meanChange:r.meanMinutes-base.meanMinutes,deferred:r.deferred,budgetUsed:r.budgetUsed,unserved:r.unserved});
}
const out={schema_version:1,generated_at:new Date().toISOString(),calibrated:false,input_sha256:sha(raw),model_sha256:sha(fs.readFileSync(new URL('static/hub_logic.js',root))),scenarios,sensitivity};
fs.writeFileSync(new URL('data/simulation/hub-results.json',root),JSON.stringify(out)+'\n');
for(const c of scenarios)console.log(JSON.stringify({id:c.id,cars:c.result.carVehicles,peak:c.result.peakCarVehicles,modes:c.result.modes,deferred:c.result.deferred,mean:c.result.meanMinutes,budget:c.result.budgetUsed,unserved:c.result.unserved}));
console.log('Sensitivity runs:',sensitivity.length);
