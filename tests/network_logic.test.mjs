import test from 'node:test';
import assert from 'node:assert/strict';
import {networkExample} from '../static/network_logic.js';
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);
test('all three direction choices preserve paths and node flow at every demand regime',()=>{
 for(const q of [0,500,1000,4000,4500,4500.1,6000,8999,9000,9001,10000,20000])for(const mode of ['forward','closed','reverse']){
  const r=networkExample(q,mode),{upper,lower,connector}=r.paths,e=r.edges;
  close(upper+lower+connector,q);close(e.sa+e.sb,q);close(e.at+e.bt,q);
  close(e.sa+(mode==='reverse'?connector:0),e.at+(mode==='forward'?connector:0));
  close(e.sb+(mode==='forward'?connector:0),e.bt+(mode==='reverse'?connector:0));
  assert.ok(Object.values(r.paths).every(v=>v>=0));
  if(mode==='closed')close(connector,0);
 }
});
test('analytic assignment is user equilibrium, not just a manually selected better split',()=>{
 for(let q=250;q<=15000;q+=137)for(const mode of ['forward','closed','reverse']){
  const r=networkExample(q,mode);for(const [key,flow]of Object.entries(r.paths)){
   const cost=r.costs[key];if(cost===null)continue;
   if(flow>1e-7)close(cost,r.minutes);
   else assert.ok(cost+1e-7>=r.minutes,`${mode} ${q}: an unused path is faster`);
  }
 }
});
test('closing the connector can improve or worsen travel time under identical demand',()=>{
 close(networkExample(4000,'forward').minutes,80);close(networkExample(4000,'closed').minutes,65);close(networkExample(4000,'reverse').minutes,65);
 close(networkExample(1000,'forward').minutes,20);close(networkExample(1000,'closed').minutes,50);
 close(networkExample(10000,'forward').minutes,95);close(networkExample(10000,'reverse').minutes,90);
 for(const mode of ['forward','closed','reverse'])close(networkExample(0,mode).vehicleHours,0);
});
test('invalid demand and unknown direction are rejected rather than producing a reassuring zero',()=>{
 for(const q of [-1,NaN,Infinity,20001,'4000'])assert.throws(()=>networkExample(q));
 assert.throws(()=>networkExample(4000,'two-way'));
});
