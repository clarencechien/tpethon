import test from 'node:test';
import assert from 'node:assert/strict';
import {decodeArchive,combineFrames} from '../static/history.js';
const sample=()=>({schema_version:1,day:'2026-10-15',sampling:'exact_quarter_hour_snapshot',columns:['sensor','speed','occupancy','volume','active_lanes','status'],sensors:[{id:'N',lat:25.07,lon:121.57,name:'Test'}],frames:[['2026-10-15T07:00:00+08:00',[[0,10,50,3,1,'0']]]]});
test('restore metadata and actual source time without multiplying flow',()=>{
 const [f]=decodeArchive(sample());assert.equal(f.road.rows[0].volume,3);assert.equal(f.road.rows[0].name,'Test');assert.equal(f.captured_at,f.road.rows[0].timestamp);
});
test('wrong date, duplicate sensors and mismatched schema rejected',()=>{
 let s=sample();s.day='2026-10-16';assert.throws(()=>decodeArchive(s));
 s=sample();s.frames[0][1].push(s.frames[0][1][0]);assert.throws(()=>decodeArchive(s));
 s=sample();s.columns.reverse();assert.throws(()=>decodeArchive(s));
});
test('archive merge preserves recent data and de-duplicates matching timestamps',()=>{
 const [past]=decodeArchive(sample());const current={captured_at:'2026-10-16T10:00:00+08:00',road:{timestamp:'2026-10-16T09:59:00+08:00',rows:[]}};
 const merged=combineFrames([current,past],[past]);assert.equal(merged.length,2);assert.equal(merged[0],past);assert.equal(merged[1],current);
});
