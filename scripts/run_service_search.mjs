import fs from 'node:fs';
import crypto from 'node:crypto';
import {searchService, trainingSeeds, validationSeeds, disturbances, candidates} from '../static/service_search_logic.js';

const root = new URL('../', import.meta.url);
const read = p => fs.readFileSync(new URL(p, root));
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const inputPath = 'data/simulation/rail-hub-inputs.json';
const input = JSON.parse(read(inputPath));
const groups = [];
for (const railPeople of [120, 240, 480]) for (const trainHeadway of [6, 10, 15]) {
  const group = searchService(input, {railPeople, trainHeadway});
  groups.push(group);
  console.log(railPeople, trainHeadway, group.selections.map(s => ({
    target: s.target, candidate: s.candidate,
    validation: s.validation.filter(r => r.passes).length + '/' + s.validation.length
  })));
}
const paths = [inputPath, 'static/rail_hub_logic.js', 'static/service_search_logic.js', 'scripts/run_service_search.mjs'];
fs.writeFileSync(new URL('data/simulation/service-search-results.json', root), JSON.stringify({
  schema_version: 1, calibrated: false, network_requests: 0,
  source_sha256: Object.fromEntries(paths.map(p => [p, sha(read(p))])),
  trainingSeeds, validationSeeds, disturbances, candidates, groups
}) + '\n');
