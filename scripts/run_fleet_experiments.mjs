import fs from 'node:fs';
import crypto from 'node:crypto';
import {robustFleet,assessFleet} from '../static/fleet_logic.js';
import {serviceDefaults} from '../static/service_logic.js';
const root=new URL('../',import.meta.url),read=p=>fs.readFileSync(new URL(p,root)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
const raw=read('data/simulation/service-inputs.json'),data=JSON.parse(raw);
const fixedPlan=[{station:'西湖',headway:3,activeFleet:14},{station:'港墘',headway:2,activeFleet:20}];
const out={schema_version:1,generated_at:new Date().toISOString(),calibrated:false,
 input_sha256:hash(raw),model_sha256:Object.fromEntries(['service_logic.js','fleet_logic.js'].map(n=>[n,hash(read('static/'+n))])),
 month:data.metro.month,days:data.metro.daily.map(d=>d.day),assumptions:serviceDefaults,baseline_plan:fixedPlan,
 shares:[.1,.2,.3,.4],roundTrips:[20,30,40,50,60],arrivalIntervals:[0,3,6],cells:[]};
for(const arrivalInterval of out.arrivalIntervals)for(const share of out.shares)for(const roundTrip of out.roundTrips){
 const a={share,roundTrip,arrivalInterval};
 const recommended=robustFleet(data.metro.daily,a),baseline=assessFleet(data.metro.daily,fixedPlan,a);
 out.cells.push({...a,recommended,baseline});
 console.log(`interval=${arrivalInterval} share=${share} roundTrip=${roundTrip} fleet=${recommended.totalFleet} baseline=${baseline.passedDays}/${baseline.testedDays}`);
}
fs.writeFileSync(new URL('data/simulation/fleet-experiment.json',root),JSON.stringify(out)+'\n');
