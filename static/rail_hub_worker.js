import {runRailHub} from './rail_hub_logic.js';
self.onmessage=({data})=>{try{self.postMessage({result:runRailHub(data.input,data.options,data.seed??7)});}catch(e){self.postMessage({error:e.message});}};
