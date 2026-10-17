import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {shiftHourly, shiftRoad, queueProfile, runStaggered, staggerPolicies} from '../static/staggered_logic.js';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url));
const input = JSON.parse(read('data/simulation/service-inputs.json'));
const archive = JSON.parse(read('data/simulation/staggered-results.json'));
const sum = a => a.reduce((s, x) => s + x, 0);
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);

test('additional hourly movement preserves the already dispersed baseline and detects new peaks', () => {
  const base = [20, 50, 30];
  assert.deepEqual(shiftHourly(base, 0).after, base);
  assert.deepEqual(shiftHourly(base, .2, .5).after, [25, 40, 35]);
  const later = shiftHourly(base, .6, 0);
  assert.deepEqual(later.after, [20, 20, 60]);
  assert.equal(later.afterPeakHour, 9);
  assert.equal(later.peakReduction, -10);
  close(later.total, sum(later.after));
  assert.equal(shiftHourly([0,0,0], .1).peakReductionShare, null);
  assert.throws(() => shiftHourly([20,null,30], .1));
});

test('all modeled travelers remain, including outside the target hour; boundaries never truncate', () => {
  const weights = input.ramp.days.find(d => d.complete).relative_weights;
  const original = shiftRoad(weights, staggerPolicies[0]);
  for (const policy of staggerPolicies) {
    const shifted = shiftRoad(weights, policy);
    close(sum(shifted.arrivals), 3000);
    assert.ok(shifted.arrivals.every(v => v >= 0));
    for (const capacity of [600,750,900]) {
      const queue = queueProfile(shifted.arrivals, capacity);
      close(queue.served + queue.residual, 3000);
    }
  }
  assert.deepEqual(shiftRoad(weights, staggerPolicies[1]), original);
  const unit = Array(240).fill(0); unit[60] = 1;
  const moved = shiftRoad(unit, {share: .2, early: .5, delay: 60}, 100);
  assert.equal(moved.arrivals[0], 10);
  assert.equal(moved.arrivals[60], 80);
  assert.equal(moved.arrivals[120], 10);
  assert.equal(moved.shiftedDemand, 20);
  assert.throws(() => shiftRoad([1, null], staggerPolicies[0]));
});

test('whole-profile translation changes timing, not total waiting, under constant capacity', () => {
  const weights = input.ramp.days.find(d => d.complete).relative_weights;
  for (const capacity of [600,750,900]) {
    const base = queueProfile(shiftRoad(weights, staggerPolicies[0]).arrivals, capacity);
    const later = queueProfile(shiftRoad(weights, staggerPolicies[2]).arrivals, capacity);
    close(base.queueVehicleHours, later.queueVehicleHours);
    close(base.peakQueue, later.peakQueue);
    assert.equal(later.lastQueueMinute, base.lastQueueMinute + 60);
  }
});

test('independent queue example and uncleared queues cannot be called fully served', () => {
  // Ten vehicles arrive uniformly in one minute; rate is one vehicle per minute.
  // Queue area: 4.5 in first minute + 40.5 over nine clearing minutes = 45 vehicle-minutes.
  const r = queueProfile([10], 60);
  close(r.queueVehicleHours, .75);
  close(r.served, 10);
  const overloaded = queueProfile([1000], 1);
  assert.equal(overloaded.complete, false);
  assert.ok(overloaded.residual > 990);
  close(overloaded.served + overloaded.residual, 1000);
});

test('actual dates, incomplete day and all generated results reproduce with verified sources', () => {
  for (const [path, hash] of Object.entries(archive.source_sha256)) assert.equal(crypto.createHash('sha256').update(read(path)).digest('hex'), hash);
  const result = runStaggered(input);
  assert.deepEqual(result.metro, archive.metro);
  assert.deepEqual(result.road, archive.road);
  assert.equal(sum(result.metro.daily.map(d => sum(d.hourly))), 414439);
  assert.equal(result.metro.daily.length, 22);
  assert.deepEqual(result.road.find(d => d.day === '2026-10-14').cases, []);
  const rows = result.road.find(d => d.complete).cases;
  assert.equal(rows.length, 21);
  const get = (policy, capacity) => rows.find(r => r.policy === policy && r.capacity === capacity);
  close(get('baseline',750).queueVehicleHours, get('split10',750).queueVehicleHours);
  assert.ok(get('split10',750).peakQueue < get('baseline',750).peakQueue);
  assert.ok(get('split10',900).queueVehicleHours > get('baseline',900).queueVehicleHours);
});
