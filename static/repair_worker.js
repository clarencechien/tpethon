import {runRepairs} from './repair_logic.js';
self.onmessage=({data})=>{try{self.postMessage({result:runRepairs(data.inputs,data.options,data.seed??7)});}catch(e){self.postMessage({error:e.message});}};
