import fs from 'node:fs';
import crypto from 'node:crypto';
import {holdingProtocol, holdingConditions, runHoldingCase} from '../static/holding_logic.js';

const root = new URL('../', import.meta.url), read = p => fs.readFileSync(new URL(p, root));
const inputPath = 'data/simulation/rail-hub-inputs.json', input = JSON.parse(read(inputPath));
const cases = [];
for (const c of holdingConditions) for (const predictedWalk of holdingProtocol.predictedWalks) {
  for (const seed of holdingProtocol.seeds) cases.push({condition: c.id, ...runHoldingCase(input, c.options, seed, predictedWalk)});
}
const audit = runHoldingCase(input, holdingConditions.find(c => c.id === 'combined').options, 401, 9, true);
const sources = [inputPath, 'data/simulation/service-search-results.json', 'static/rail_hub_logic.js', 'static/holding_logic.js', 'scripts/run_holding.mjs'];
const result = {schema_version: 1, calibrated: false, network_requests: 0, protocol: holdingProtocol,
  conditions: holdingConditions, source_sha256: Object.fromEntries(sources.map(p => [p, crypto.createHash('sha256').update(read(p)).digest('hex')])), cases, audit};
fs.writeFileSync(new URL('data/simulation/holding-results.json', root), JSON.stringify(result) + '\n');
for (const limit of holdingProtocol.holdLimits) {
  const rows = cases.map(c => c.results.find(r => r.limit === limit));
  console.log('Hold', limit, 'relative pass', rows.filter(r => r.passes).length, '/', rows.length,
    'with 95% on time', rows.filter(r => r.readyPass).length,
    'max new late vs base', Math.max(...rows.map(r => r.newlyLate)),
    'vs no hold', Math.max(...rows.map(r => r.newlyLateVersusNoHold)));
}
