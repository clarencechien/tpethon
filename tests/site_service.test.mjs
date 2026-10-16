import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {assessSpace} from '../static/space_logic.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url)),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
test('single-origin pilot cases reproduce without pooling stations or double-booking base bays',()=>{
 const input=JSON.parse(read('data/simulation/service-inputs.json')),out=JSON.parse(read('data/simulation/site-service.json'));
 assert.equal(out.input_sha256,hash(read('data/simulation/service-inputs.json')));
 assert.equal(out.site_input_sha256,hash(read('data/simulation/site-plan.json')));
 for(const [name,digest] of Object.entries(out.model_sha256))assert.equal(digest,hash(read('static/'+name)));
 for(const p of out.plans){
  const days=input.metro.daily.map(d=>({day:d.day,stations:d.stations.filter(s=>s.name===p.station)}));
  const pilot=p.scenarios.find(c=>c.id==='pilot');assert.deepEqual(assessSpace(days,pilot.options),pilot.result);
  assert.equal(pilot.result.passedDays,22);assert.equal(pilot.result.plan.offeredFleet,10);
  assert.equal(p.scenarios.find(c=>c.id==='lean_detour').result.passedDays,0);
  assert.equal(p.scenarios.find(c=>c.id==='slow_loop').result.passedDays,0);
  assert.equal(p.operating_draft.overnight_bays_requested,10);assert.equal(p.operating_draft.verified_available_bays,null);
 }
 assert.equal(out.simultaneous_two_lines.overnight_bays_requested,20);
 assert.equal(out.simultaneous_two_lines.rest_bays_requested,4);
 assert.equal(out.simultaneous_two_lines.shared_dispatch_simulated,false);
});
