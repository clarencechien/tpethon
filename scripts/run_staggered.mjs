import fs from 'node:fs';
import crypto from 'node:crypto';
import {runStaggered, staggerPolicies} from '../static/staggered_logic.js';
const root = new URL('../', import.meta.url), read = p => fs.readFileSync(new URL(p, root));
const source = 'data/simulation/service-inputs.json', input = JSON.parse(read(source));
const result = runStaggered(input);
const paths = [source, 'static/staggered_logic.js', 'static/simulation_logic.js', 'scripts/run_staggered.mjs'];
const out = {schema_version: 1, calibrated: false, network_requests: 0, policies: staggerPolicies,
  source_sha256: Object.fromEntries(paths.map(p => [p, crypto.createHash('sha256').update(read(p)).digest('hex')])),
  evidence: {metroSource: input.metro.source, month: input.metro.month, weekdays: input.metro.weekdays,
    totalJourneys: input.metro.total_journeys, rampUnitVerified: input.ramp.unit_verified,
    rampArrivalsMeasured: input.ramp.arrivals_measured, windowStart: '16:30', eligibleStart: '17:30', eligibleEnd: '18:30'},
  ...result};
fs.writeFileSync(new URL('data/simulation/staggered-results.json', root), JSON.stringify(out) + '\n');
console.log('Observed hourly mean', result.metro.hourly);
console.log('10% split additional', result.metro.cases.find(c => c.share === .1 && c.early === .5).aggregate);
for (const d of result.road) for (const r of d.cases.filter(r => r.capacity === 750)) {
  console.log(d.day, r.policy, 'moved', r.shiftedDemand, 'queue hours', r.queueVehicleHours, 'residual', r.residual);
}
