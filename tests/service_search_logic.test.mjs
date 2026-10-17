import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import {evaluate, meets, selectCandidate, searchService, trainingSeeds, validationSeeds} from '../static/service_search_logic.js';

const read = p => fs.readFileSync(new URL('../' + p, import.meta.url));
const input = JSON.parse(read('data/simulation/rail-hub-inputs.json'));
const archive = JSON.parse(read('data/simulation/service-search-results.json'));

test('all source hashes and every search/holdout result reproduce offline', () => {
  for (const [path, hash] of Object.entries(archive.source_sha256)) {
    assert.equal(crypto.createHash('sha256').update(read(path)).digest('hex'), hash);
  }
  assert.equal(archive.network_requests, 0);
  assert.equal(archive.groups.length, 9);
  assert.equal(new Set(archive.groups.map(g => JSON.stringify(g.condition))).size, 9);
  assert.ok(trainingSeeds.every(s => !validationSeeds.includes(s)));
  for (const group of archive.groups) assert.deepEqual(searchService(input, group.condition), group);
});

test('every candidate retains the identical baseline, BRT reference and no-car scope', () => {
  for (const group of archive.groups) {
    assert.equal(group.trials.length, 20);
    for (const trial of group.trials) for (const [i, row] of trial.rows.entries()) {
      assert.deepEqual(row.base, group.trials[0].rows[i].base);
      assert.deepEqual(row.brt, group.trials[0].rows[i].brt);
      assert.equal(row.base.fleet, 2);
      assert.equal(row.brt.fleet, 4);
      assert.equal(row.mixed.fleet, trial.candidate.fleet);
      for (const r of [row.base, row.brt, row.mixed]) {
        assert.equal(r.converted, 0);
        assert.equal(r.roadImpactAssessed, false);
        assert.ok(r.cost >= (r.fleet + r.spares) * 3 * 1200);
      }
    }
  }
});

test('manual gate example rejects harm, missing riders, equal cost and meaningless benchmark', () => {
  const row = {brt: {gain: 10, incrementalCost: 100}, mixed: {gain: 8, incrementalCost: 50, newlyLate: 0, unserved: 0}};
  assert.equal(meets(row, 0.8), true);
  assert.equal(meets(row, 0.9), false);
  for (const change of [{newlyLate: 1}, {unserved: 1}, {incrementalCost: 100}, {gain: 2}]) {
    assert.equal(meets({...row, mixed: {...row.mixed, ...change}}, 0.5), false);
  }
  assert.equal(meets({...row, brt: {...row.brt, gain: 0}}, 0.5), false);
});

test('selection uses only eligible training results; no holdout-driven retuning', () => {
  const row = {brt: {gain: 10, incrementalCost: 100}, mixed: {gain: 8, incrementalCost: 50, newlyLate: 0, unserved: 0}};
  const good = {candidate: {fleet: 3, buffer: 2}, rows: [row], summary: {meanCost: 50}, validation: [{passes: false}]};
  const harm = {candidate: {fleet: 2, buffer: 0}, rows: [{...row, mixed: {...row.mixed, newlyLate: 1}}], summary: {meanCost: 0}, validation: [{passes: true}]};
  assert.equal(selectCandidate([harm, good], 0.5), good);
  assert.equal(selectCandidate([harm], 0.5), null);
  for (const g of archive.groups) for (const selection of g.selections) {
    const eligible = g.trials.filter(t => t.rows.every(r => meets(r, selection.target)));
    if (!selection.candidate) {
      assert.equal(eligible.length, 0);
      assert.deepEqual(selection.validation, []);
      continue;
    }
    assert.equal(selection.training.meanCost, Math.min(...eligible.map(t => t.summary.meanCost)));
    assert.equal(selection.validation.length, 12);
    for (const row of selection.validation) {
      assert.ok(validationSeeds.includes(row.seed));
      assert.equal(row.mixed.fleet, selection.candidate.fleet);
      assert.equal(row.passes, meets(row, selection.target));
    }
  }
});

test('default lower-cost selection fails reliability despite improving average time', () => {
  const g = archive.groups.find(g => g.condition.railPeople === 240 && g.condition.trainHeadway === 10);
  const chosen = g.selections[0];
  assert.deepEqual(chosen.candidate, {id: 'f4-b5', fleet: 4, buffer: 5});
  assert.equal(chosen.validation.filter(r => r.passes).length, 4);
  assert.equal(Math.max(...chosen.validation.map(r => r.mixed.newlyLate)), 59);
  assert.ok(chosen.validation.some(r => r.mixed.gain > chosen.training.meanGain && r.mixed.newlyLate > 0));
  assert.equal(g.selections[1].candidate, null);
  const row = evaluate(input, g.condition, chosen.candidate, 7);
  assert.ok(Math.abs(row.mixed.incrementalCost - (row.brt.incrementalCost - 12000)) < 1e-8);
});
