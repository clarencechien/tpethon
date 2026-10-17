import {runCorridorTrial} from './corridor_trial_logic.js';
self.onmessage=({data})=>{try{self.postMessage({result:runCorridorTrial(data.input,data.options,data.seed??7)});}catch(e){self.postMessage({error:e.message});}};
