import {assessSpace,serviceEnvelope} from './space_logic.js';
self.onmessage=({data})=>{
 try{const result=assessSpace(data.days,data.options),envelope=serviceEnvelope(data.days,data.options);self.postMessage({result,envelope});}
 catch(e){self.postMessage({error:e.message});}
};
