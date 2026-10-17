import {compareAlternatives} from './alternatives_logic.js';
self.onmessage=({data})=>{try{self.postMessage({result:compareAlternatives(data.inputs,data.options,data.seed??7)});}catch(e){self.postMessage({error:e.message});}};
