import test from 'node:test';
import assert from 'node:assert/strict';
import {classify, filtered, repeatedEvidence, color} from '../static/logic.js';
const reference=Date.parse('2026-10-16T08:00:00+08:00');
const row={id:'V1:L1',vd_id:'V1',link_id:'L1',name:'堤頂大道',direction:'N',timestamp:'2026-10-16T07:59:00+08:00',status:'0',active_lanes:2,speed:10,occupancy:40};
test('low speed and occupancy needed for candidate',()=>{
 assert.equal(classify(row,reference),'hot');
 assert.equal(classify({...row,occupancy:10},reference),'slow');
 assert.equal(classify({...row,occupancy:null},reference),'slow');
 assert.equal(classify({...row,speed:45},reference),'normal');
});
test('empty or faulty lanes are not congestion',()=>{
 for(const patch of [{active_lanes:0,speed:0},{speed:null},{status:'1'}])assert.equal(classify({...row,...patch},reference),'invalid');
});
test('stale and future timestamps never treated as fresh',()=>{
 assert.equal(classify(row,reference+660000),'stale');
 assert.equal(classify(row,reference-300000),'stale');
 assert.equal(color(row,'speed',reference+660000),'#9ba8a0');
});
test('direction and search filters are conjunctive',()=>{
 assert.equal(filtered([row],'堤頂','N','V1').length,1);
 assert.equal(filtered([row],'堤頂','S','V1').length,0);
});
test('repeat evidence deduplicates source timestamps and excludes old observations',()=>{
 const frames=[{captured_at:'2026-10-16T08:00:00+08:00',road:{rows:[row]}},{captured_at:'2026-10-16T08:01:00+08:00',road:{rows:[row]}}];
 assert.deepEqual(repeatedEvidence(row.id,frames,1),{hot:1,total:1});
});
