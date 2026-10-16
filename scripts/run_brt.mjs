import fs from 'node:fs';
import {brtDefaults,brtVersion,brtScenarios,conversionScan,transitionYears} from '../static/brt_logic.js';
const brief=({series,...r})=>r;
const report={modelVersion:brtVersion,calibrated:false,inputType:'synthetic_shape_and_assumed_magnitude',assumptions:brtDefaults,
 caveat:'Illustrative abstract corridor, not a calibrated Neihu forecast. Historical BRT case loads are not causal congestion effects.',
 scenarios:brtScenarios(brtDefaults).map(brief),conversionScan:conversionScan(brtDefaults),annual:transitionYears(brtDefaults)};
fs.writeFileSync(new URL('../data/simulation/brt-experiment.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({model:brtVersion,scenarios:report.scenarios.map(r=>({mode:r.mode,roadQueuePCUHours:r.queuePCUHours,waitingPassengerHours:r.totalPassengerWaitHours,requiredFleet:r.requiredFleet})),firstTestedImprovement:report.conversionScan.firstTestedImprovement},null,2));
