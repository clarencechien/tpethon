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

const {taipeiParts,previousDay,periodFrames,summarizePeriod,heatCells}=await import('../static/logic.js');
const at=(time,patch={})=>{const timestamp='2026-10-16T'+time+':00+08:00';return {captured_at:timestamp,road:{timestamp,rows:[{...row,timestamp,...patch}]}};};
test('Taipei dates and morning boundaries are explicit',()=>{
 assert.deepEqual(taipeiParts('2026-10-15T23:00:00Z'),{day:'2026-10-16',minute:420});
 assert.equal(previousDay('2026-03-01'),'2026-02-28');
 assert.equal(periodFrames([at('06:59'),at('07:00'),at('09:29'),at('09:30')],'2026-10-16','am').length,2);
});
test('missing yesterday is unknown, never zero congestion',()=>{
 const summary=summarizePeriod([at('08:00')],'2026-10-15','pm');
 assert.equal(summary.covered,0);assert.equal(summary.expected,10);assert.equal(summary.slowShare,null);
});
test('time-bin averages do not overweight a frequently sampled slot',()=>{
 const s=summarizePeriod([at('08:00'),at('08:01'),at('08:15',{speed:50,occupancy:5})],'2026-10-16','am');
 assert.equal(s.covered,2);assert.equal(s.coverage,.2);assert.equal(s.slowShare,.5);
});
test('all invalid observations do not count as coverage',()=>{
 const s=summarizePeriod([at('08:00',{status:'1'})],'2026-10-16','am');
 assert.equal(s.frames.length,1);assert.equal(s.covered,0);assert.equal(s.slowShare,null);
});
test('heat areas preserve proportions rather than amplify detector density',()=>{
 const point={...row,lat:25.08,lon:121.57};
 const a=heatCells([point],reference)[0],b=heatCells([point,{...point,id:'V2:L2'}],reference)[0];
 assert.equal(a.hotShare,b.hotShare);assert.equal(a.opacity,b.opacity);assert.equal(a.fill,b.fill);
 assert.equal(heatCells([{...point,status:'1'}],reference).length,0);
});
