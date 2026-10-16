import test from 'node:test';
import assert from 'node:assert/strict';
import {dataAvailability,scheduleMessage} from '../static/availability.js';
const at=t=>`2026-10-16T${t}:00+08:00`,now=Date.parse(at('14:00'));
const frame=t=>({captured_at:at(t),road:{timestamp:at(t),rows:[{id:'TEST',name:'Test',timestamp:at(t),speed:10,occupancy:50,active_lanes:1,status:'0'}]}});
test('an afternoon fresh snapshot does not fill missing morning or claim no congestion',()=>{
 const f=frame('13:59'),a=dataAvailability({current:f,frames:[frame('10:07'),f]},now);
 assert.equal(a.am.covered,0);assert.equal(a.am.slowShare,null);assert.equal(a.stale,false);assert.match(a.reason,/10:07/);assert.match(a.reason,/隔日/);
});
test('partial observations and stale source stay distinct from publication freshness',()=>{
 const f=frame('10:07'),a=dataAvailability({generated_at:at('14:00'),current:f,frames:[frame('07:01'),frame('07:16'),f]},now);
 assert.equal(a.am.covered,2);assert.equal(a.am.coverage,.2);assert.equal(a.stale,true);assert.equal(a.am.slowShare,1);
});
test('future morning and impossible future snapshots are not counted as observed',()=>{
 const a=dataAvailability({current:frame('06:00'),frames:[frame('07:01')]},Date.parse(at('06:00')));
 assert.equal(a.phase,'not_started');assert.equal(a.am.covered,0);assert.match(a.reason,/尚未開始/);
});
test('configured cron without executions is not reported as healthy',()=>{
 assert.match(scheduleMessage({workflows:{'pages.yml':{status:'no_scheduled_runs'}}}),/尚查無定時觸發/);
 assert.match(scheduleMessage(null),/尚未取得/);
 assert.match(scheduleMessage({workflows:{'pages.yml':{status:'observed',latest:{created_at:at('13:07'),conclusion:'failure'},last_success_in_recent_runs:null}}}),/失敗/);
});
