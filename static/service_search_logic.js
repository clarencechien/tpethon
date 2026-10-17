/** E12: finite dispatch search. Uses the unchanged E11 model, without network access. */
import {runRailHub} from './rail_hub_logic.js';

export const trainingSeeds = [7, 19, 41];
export const validationSeeds = [101, 211, 307];
export const disturbances = [
  {id: 'nominal', label: '沒有額外延誤', options: {}},
  {id: 'transfer', label: '列車晚5分＋步行多3分', options: {trainDelay: 5, walkDelay: 3}},
  {id: 'road', label: '巴士車程增加25%', options: {actualRideFactor: 1.25}},
  {id: 'combined', label: '列車、步行與巴士都延誤', options: {trainDelay: 5, walkDelay: 3, actualRideFactor: 1.25}}
];
export const candidates = [2, 3, 4, 5, 6].flatMap(fleet =>
  [0, 2, 5, 8].map(buffer => ({id: `f${fleet}-b${buffer}`, fleet, buffer})));
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;

export function compact(r, people) {
  return {
    fleet: r.fleet, spares: r.spares,
    gain: r.railPersonMinutesChange === 0 ? 0 : -r.railPersonMinutesChange / people,
    meanMinutes: r.railMeanMinutes, p95Wait: r.railP95Wait,
    newlyLate: r.existingNewlyLate, unserved: r.railUnserved,
    cost: r.cost, incrementalCost: r.incrementalCost, busKm: r.busKm,
    converted: r.converted, roadImpactAssessed: r.roadImpactAssessed
  };
}

export function evaluate(input, condition, candidate, seed, disturbance = {}) {
  // Baseline always has two buses, zero offset and a ten-minute target headway.
  // Neither the candidate nor the holdout outcome changes its specification.
  const common = {...condition, carPeople: 0, railSparePerTrain: 0, baseFleet: 2, ...disturbance};
  const reference = runRailHub(input, {...common, extraFleet: 2, connectionBuffer: 2}, seed);
  const base = compact(reference.results[0], condition.railPeople);
  const brt = compact(reference.results.find(r => r.id === 'priority'), condition.railPeople);
  const trial = runRailHub(input, {...common, extraFleet: candidate.fleet - 2, connectionBuffer: candidate.buffer}, seed);
  const mixed = compact(trial.results.find(r => r.id === 'expanded'), condition.railPeople);
  return {seed, base, brt, mixed};
}

export function meets(row, target) {
  return row.brt.gain > 0 && row.mixed.gain >= Math.max(3, target * row.brt.gain) - 1e-9
    && row.mixed.newlyLate === 0 && row.mixed.unserved === 0
    && row.mixed.incrementalCost < row.brt.incrementalCost;
}

export function summarize(rows) {
  return {
    meanGain: avg(rows.map(r => r.mixed.gain)),
    minGain: Math.min(...rows.map(r => r.mixed.gain)),
    meanCost: avg(rows.map(r => r.mixed.incrementalCost)),
    maxNewlyLate: Math.max(...rows.map(r => r.mixed.newlyLate)),
    maxUnserved: Math.max(...rows.map(r => r.mixed.unserved))
  };
}

export function selectCandidate(trials, target) {
  const eligible = trials.filter(t => t.rows.every(r => meets(r, target)));
  // Only nominal training observations participate in selection.
  eligible.sort((a, b) => a.summary.meanCost - b.summary.meanCost
    || a.candidate.fleet - b.candidate.fleet || a.candidate.buffer - b.candidate.buffer);
  return eligible[0] || null;
}

export function searchService(input, condition) {
  if (![120, 240, 480].includes(condition.railPeople) || ![6, 10, 15].includes(condition.trainHeadway)) {
    throw Error('Unsupported condition');
  }
  const trials = candidates.map(candidate => {
    const rows = trainingSeeds.map(seed => evaluate(input, condition, candidate, seed));
    return {candidate, rows, summary: summarize(rows)};
  });
  const selections = [0.5, 0.8].map(target => {
    const selected = selectCandidate(trials, target);
    if (!selected) return {target, candidate: null, training: null, validation: []};
    const validation = disturbances.flatMap(d => validationSeeds.map(seed => {
      const row = evaluate(input, condition, selected.candidate, seed, d.options);
      return {...row, disturbance: d.id, passes: meets(row, target)};
    }));
    return {target, candidate: selected.candidate, training: selected.summary, validation};
  });
  return {condition, trials, selections};
}
