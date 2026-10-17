import {simulateHubs} from './hub_logic.js';
self.onmessage=({data:{inputs,options,seed=7}})=>{try{const result=simulateHubs(inputs,options,seed),baseline=simulateHubs(inputs,{...options,layer:0,hov:0,poolSubsidy:0,parkingSubsidy:0,capacityScale:1},seed);self.postMessage({result,baseline});}catch(e){self.postMessage({error:e.message});}};
