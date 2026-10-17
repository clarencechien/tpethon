/** E13: bounded connection holding. Never reads future passenger arrival times to decide a hold. */
import {railHubDefaults, railCohort, railTimetable} from './rail_hub_logic.js';

const END = 300, LAST = 180;
const sum = a => a.reduce((s, x) => s + x, 0);
const time = p => p.finish === null ? Infinity : p.finish;
const clipped = p => Math.min(END, time(p));
export const holdingProtocol = Object.freeze({
  railPeople: 240, carPeople: 0, trainHeadway: 10, fleet: 4, buffer: 5,
  holdLimits: [0, 2, 4, 6], predictedWalks: [6, 9], minimumOnTimeShare: .95,
  seeds: [401, 503, 607, 709, 811, 907, 1009, 1103, 1201, 1301]
});
export const holdingConditions = [
  {id: 'nominal', label: '無額外延誤', options: {}},
  {id: 'transfer', label: '列車晚5分＋步行多3分', options: {trainDelay: 5, walkDelay: 3}},
  {id: 'road', label: '巴士車程增加25%', options: {actualRideFactor: 1.25}},
  {id: 'combined', label: '列車、步行與巴士同時延誤', options: {trainDelay: 5, walkDelay: 3, actualRideFactor: 1.25}},
  {id: 'severe', label: '新壓力：列車晚8分、步行多5分、車程增加40%', options: {trainDelay: 8, walkDelay: 5, actualRideFactor: 1.4}}
];

export function decideHold({now, limit, predictedWalk, notices, load, capacity}) {
  if (load >= capacity || limit === 0) return {departure: now, notice: null};
  // notices contains only train door-open timestamps, not future passenger arrivals.
  const targets = notices.filter(t => t <= now && t + predictedWalk > now
    && t + predictedWalk <= Math.min(now + limit, LAST));
  if (!targets.length) return {departure: now, notice: null};
  const notice = Math.min(...targets);
  return {departure: notice + predictedWalk, notice};
}

export function dispatchHolding(input, options = {}, seed = 401, policy = {}) {
  const a = {...railHubDefaults, railPeople: 240, carPeople: 0, ...options};
  const {fleet = 4, buffer = 5, limit = 0, predictedWalk = 6, baseline = false, priority = false} = policy;
  if (!Number.isInteger(fleet) || fleet < 0 || fleet > 12 || !Number.isFinite(limit) || limit < 0 || limit > 6
      || !Number.isFinite(predictedWalk) || predictedWalk < 0 || predictedWalk > 20) throw Error('Invalid holding policy');
  if (a.carPeople !== 0 || !Number.isInteger(a.railPeople) || a.railPeople < 1 || a.railPeople > 3000) throw Error('Rail-only positive cohort required');
  const speed = priority ? a.prioritySpeed : a.mixedSpeed;
  const extra = priority ? 1 + a.priorityDelay : 5 + a.mixedDelay;
  const out = input.paths.hub_out.distance_km / speed * 60 + extra;
  const back = input.paths.hub_back.distance_km / speed * 60 + extra;
  const roundKm = input.paths.hub_out.distance_km + input.paths.hub_back.distance_km;
  const deadheadKm = input.paths.base_hub.distance_km + input.paths.hub_base.distance_km;
  const cohort = railCohort(a, seed);
  const slots = railTimetable(fleet, out + back + a.restMinutes,
    baseline ? a.busHeadway : a.trainHeadway, baseline ? 0 : a.walkMinutes + buffer);
  const notices = cohort.trains.map(t => t + a.trainDelay);
  const pending = cohort.people.map(p => ({...p, arrival: p.trainArrival + a.trainDelay + a.walkMinutes + a.walkDelay}));
  const buses = Array.from({length: fleet}, () => ({ready: 0, trips: 0, lastReturn: 0}));
  const records = [], cycles = [], holds = [];
  let previous = -1;
  for (const slot of slots) {
    const bus = buses.indexOf(buses.reduce((x, y) => x.ready <= y.ready ? x : y));
    const vehicle = buses[bus], now = Math.max(slot.time, vehicle.ready, previous + 1);
    if (now > LAST) break;
    const waiting = pending.filter(p => p.arrival <= now).sort((x, y) => x.arrival - y.arrival || x.id - y.id).slice(0, a.capacity);
    const decision = decideHold({now, limit, predictedWalk, notices, load: waiting.length, capacity: a.capacity});
    const at = decision.departure, held = at - now;
    if (held > 0) holds.push({planned: slot.time, start: now, departure: at, notice: decision.notice,
      predictedWalk, minutes: held, onboard: waiting.map(p => p.id)});
    const available = pending.filter(p => p.arrival <= at).sort((x, y) => x.arrival - y.arrival || x.id - y.id).slice(0, a.capacity);
    // An empty hold still occupies the vehicle until its release time.
    if (!available.length) {vehicle.ready = at; continue;}
    previous = at;
    vehicle.trips++;
    vehicle.ready = at + (out + back) * a.actualRideFactor + a.restMinutes;
    vehicle.lastReturn = vehicle.ready;
    cycles.push({bus, planned: slot.time, departure: at, return: vehicle.ready, people: available.length, hold: held});
    const boarded = new Set(available.map(p => p.id));
    for (const p of available) records.push({...p, boardedAt: at, finish: at + out * a.actualRideFactor + 5});
    for (let i = pending.length - 1; i >= 0; i--) if (boarded.has(pending[i].id)) pending.splice(i, 1);
  }
  for (const p of pending) records.push({...p, boardedAt: null, finish: null});
  records.sort((x, y) => x.id - y.id);
  const used = buses.filter(b => b.trips), spares = fleet ? Math.ceil(fleet * .1) : 0;
  const hours = sum(used.map(b => Math.max(3, (b.lastReturn + deadheadKm / speed * 60 * a.actualRideFactor) / 60)))
    + (fleet - used.length) * 3 + spares * 3;
  const done = records.filter(p => time(p) <= END);
  return {records, cycles, holds, summary: {
    fleet, spares, cost: hours * a.busHourCost + (priority ? a.infrastructureCost : 0),
    busKm: cycles.length * roundKm + used.length * deadheadKm,
    meanMinutes: done.length ? sum(done.map(p => p.finish - p.start)) / done.length : null,
    unserved: records.length - done.length, late: records.filter(p => time(p) > p.deadline).length,
    onTimeShare: records.filter(p => time(p) <= p.deadline).length / records.length,
    onboardHoldPersonMinutes: sum(holds.map(h => h.minutes * h.onboard.length)),
    onboardHeldPeople: new Set(holds.flatMap(h => h.onboard)).size,
    heldDepartures: holds.length, maxHold: Math.max(0, ...holds.map(h => h.minutes))
  }};
}

export function compareHolding(run, base, noHold) {
  const baseById = new Map(base.records.map(p => [p.id, p]));
  const noHoldById = new Map(noHold.records.map(p => [p.id, p]));
  const difference = p => clipped(p) - clipped(noHoldById.get(p.id));
  return {...run.summary,
    gain: sum(run.records.map(p => clipped(baseById.get(p.id)) - clipped(p))) / run.records.length,
    gainVersusNoHold: -sum(run.records.map(difference)) / run.records.length || 0,
    newlyLate: run.records.filter(p => time(baseById.get(p.id)) <= p.deadline && time(p) > p.deadline).length,
    newlyLateVersusNoHold: run.records.filter(p => time(noHoldById.get(p.id)) <= p.deadline && time(p) > p.deadline).length,
    earlier: run.records.filter(p => difference(p) < -1e-8).length,
    later: run.records.filter(p => difference(p) > 1e-8).length,
    unchanged: run.records.filter(p => Math.abs(difference(p)) <= 1e-8).length,
    incrementalCost: run.summary.cost - base.summary.cost,
    costVersusNoHold: run.summary.cost - noHold.summary.cost,
    roadImpactAssessed: false
  };
}

export function runHoldingCase(input, options, seed, predictedWalk, audit = false) {
  const base = dispatchHolding(input, options, seed, {fleet: 2, baseline: true});
  const noHold = dispatchHolding(input, options, seed);
  const brtRun = dispatchHolding(input, options, seed, {fleet: 4, buffer: 2, priority: true});
  const brt = compareHolding(brtRun, base, noHold);
  const results = holdingProtocol.holdLimits.map(limit => {
    const run = limit ? dispatchHolding(input, options, seed, {limit, predictedWalk}) : noHold;
    const summary = compareHolding(run, base, noHold);
    const servicePass = brt.gain > 0 && summary.gain >= Math.max(3, brt.gain * .5) - 1e-9
      && summary.newlyLate === 0 && summary.unserved === 0 && summary.incrementalCost < brt.incrementalCost;
    const passes = servicePass && summary.newlyLateVersusNoHold === 0;
    return {limit, ...summary, servicePass, passes,
      readyPass: passes && summary.onTimeShare >= holdingProtocol.minimumOnTimeShare,
      ...(audit ? {records: run.records, cycles: run.cycles, holds: run.holds} : {})};
  });
  return {seed, options, predictedWalk, base: base.summary, brt, results};
}
