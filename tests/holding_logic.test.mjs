import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {runRailHub} from '../static/rail_hub_logic.js';
import {decideHold, dispatchHolding, compareHolding, runHoldingCase, holdingProtocol, holdingConditions} from '../static/holding_logic.js';
const read = p => fs.readFileSync(new URL('../' + p, import.meta.url));
const input = JSON.parse(read('data/simulation/rail-hub-inputs.json'));
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-8, `${a} != ${b}`);

test('controller cannot wait for a train that has not arrived, and obeys capacity and cutoffs', () => {
  const base = {now: 10, limit: 4, predictedWalk: 6, notices: [8], load: 10, capacity: 60};
  assert.deepEqual(decideHold(base), {departure: 14, notice: 8});
  assert.equal(decideHold({...base, notices: [11]}).departure, 10);
  assert.equal(decideHold({...base, notices: [8, 11]}).departure, 14);
  assert.equal(decideHold({...base, limit: 2}).departure, 10);
  assert.equal(decideHold({...base, load: 60}).departure, 10);
  assert.equal(decideHold({...base, now: 179, notices: [175]}).departure, 179);
});

test('zero-hold, baseline and BRT exactly reproduce the unchanged E11 engine', () => {
  for (const condition of holdingConditions) for (const seed of [401, 709]) {
    const options = {...condition.options, railPeople: 240, carPeople: 0, extraFleet: 2, connectionBuffer: 5};
    const old = runRailHub(input, options, seed);
    const base = dispatchHolding(input, options, seed, {fleet: 2, baseline: true});
    const zero = dispatchHolding(input, options, seed);
    const r = compareHolding(zero, base, zero), expected = old.results.find(r => r.id === 'expanded');
    close(base.summary.cost, old.results[0].cost);
    close(base.summary.meanMinutes, old.results[0].railMeanMinutes);
    close(r.gain, -expected.railPersonMinutesChange / 240);
    close(r.meanMinutes, expected.railMeanMinutes);
    close(r.cost, expected.cost);
    close(r.busKm, expected.busKm);
    assert.equal(r.newlyLate, expected.existingNewlyLate);
    assert.equal(r.unserved, expected.railUnserved);
    const brt = dispatchHolding(input, options, seed, {fleet: 4, buffer: 2, priority: true});
    const oldBrt = runRailHub(input, {...options, connectionBuffer: 2}, seed).results.find(r => r.id === 'priority');
    close(brt.summary.cost, oldBrt.cost);
    close(brt.summary.meanMinutes, oldBrt.railMeanMinutes);
  }
});

test('holds conserve all people, charge onboard time, propagate vehicle occupancy and retain rest', () => {
  for (const condition of holdingConditions) for (const limit of [2, 4, 6]) {
    const run = dispatchHolding(input, condition.options, 401, {limit, predictedWalk: 9});
    assert.equal(run.records.length, 240);
    assert.equal(new Set(run.records.map(p => p.id)).size, 240);
    assert.equal(run.records.filter(p => p.finish === null || p.finish > 300).length, run.summary.unserved);
    close(run.summary.onboardHoldPersonMinutes, run.holds.reduce((s, h) => s + h.minutes * h.onboard.length, 0));
    for (const h of run.holds) {
      assert.ok(h.minutes <= limit && h.minutes > 0);
      assert.ok(h.notice <= h.start);
      assert.ok(h.departure <= 180);
      for (const id of h.onboard) {
        const p = run.records.find(p => p.id === id);
        assert.ok(p.arrival <= h.start);
        assert.equal(p.boardedAt, h.departure);
      }
    }
    for (const c of run.cycles) {
      assert.ok(c.departure >= c.planned);
      assert.ok(c.people <= 60);
      assert.ok(run.cycles.filter(d => d.departure <= c.departure && d.return > c.departure).length <= 4);
      const subsequent = run.cycles.find(d => d.bus === c.bus && d.departure > c.departure);
      if (subsequent) assert.ok(subsequent.departure >= c.return);
    }
    assert.ok(run.summary.cost >= 5 * 3 * 1200);
  }
  assert.equal(dispatchHolding(input, {}, 401, {fleet: 0}).summary.unserved, 240);
  assert.throws(() => dispatchHolding(input, {}, 401, {limit: 7}));
});

test('paired comparisons include later passengers rather than only newly late passengers', () => {
  const p = (id, finish) => ({id, finish, deadline: 20});
  const base = {records: [p(0, 15), p(1, 25), p(2, 15)], summary: {cost: 0}};
  const noHold = {...base, summary: {cost: 10}};
  const run = {records: [p(0, 21), p(1, 15), p(2, 16)], summary: {cost: 12}};
  const r = compareHolding(run, base, noHold);
  assert.equal(r.newlyLate, 1);
  assert.equal(r.newlyLateVersusNoHold, 1);
  assert.equal(r.earlier, 1);
  assert.equal(r.later, 2);
  assert.equal(r.unchanged, 0);
  assert.equal(r.costVersusNoHold, 2);
  close(r.gainVersusNoHold, 1);
});

test('all fixed conditions reproduce; absolute punctuality catches the all-late baseline blind spot', () => {
  const archive = JSON.parse(read('data/simulation/holding-results.json'));
  for (const [path, hash] of Object.entries(archive.source_sha256)) {
    assert.equal(crypto.createHash('sha256').update(read(path)).digest('hex'), hash);
  }
  assert.deepEqual(archive.protocol, holdingProtocol);
  assert.equal(archive.cases.length, 100);
  assert.equal(new Set(archive.cases.map(c => JSON.stringify([c.condition, c.predictedWalk, c.seed]))).size, 100);
  assert.ok(holdingProtocol.seeds.every(s => ![7,19,41,101,211,307].includes(s)));
  for (const c of archive.cases) {
    assert.deepEqual(runHoldingCase(input, c.options, c.seed, c.predictedWalk), (({condition, ...r}) => r)(c));
    for (const r of c.results) assert.equal(r.earlier + r.later + r.unchanged, 240);
  }
  assert.deepEqual(archive.audit, runHoldingCase(input, holdingConditions[3].options, 401, 9, true));
  assert.deepEqual(holdingProtocol.holdLimits.map(limit => archive.cases.filter(c => c.results.find(r => r.limit === limit).passes).length), [36,36,36,38]);
  assert.ok(archive.cases.some(c => c.results.some(r => r.newlyLateVersusNoHold > 0)));
  for (const c of archive.cases.filter(c => c.condition === 'severe')) for (const r of c.results) {
    assert.equal(r.newlyLate, 0);
    assert.equal(r.onTimeShare, 0);
    assert.equal(r.readyPass, false);
  }
});
