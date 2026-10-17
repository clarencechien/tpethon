/** Incremental time redistribution from an already dispersed profile; no mode shift. */
import {queueStep} from './simulation_logic.js';
const sum = a => a.reduce((s, x) => s + x, 0);
export const staggerPolicies = [
  {id: 'baseline', label: '維持原型態', share: 0, delay: 60, early: 0},
  {id: 'permission_only', label: '只開放彈性，實際時間不變', share: 0, delay: 60, early: 0},
  {id: 'all_later', label: '整批一起延後60分', share: 1, delay: 60, early: 0, all: true},
  {id: 'later10', label: '指定時窗10%再延後60分', share: .1, delay: 60, early: 0},
  {id: 'split10', label: '指定時窗10%分向前後60分', share: .1, delay: 60, early: .5},
  {id: 'split20', label: '指定時窗20%分向前後60分', share: .2, delay: 60, early: .5},
  {id: 'split30', label: '指定時窗10%分向前後30分', share: .1, delay: 30, early: .5}
];
const validShare = x => Number.isFinite(x) && x >= 0 && x <= 1;
export function shiftHourly(hourly, share, early = .5) {
  if (!Array.isArray(hourly) || hourly.length !== 3 || hourly.some(x => !Number.isFinite(x) || x < 0)
    || !validShare(share) || !validShare(early)) throw Error('Invalid hourly redistribution');
  const moved = hourly[1] * share;
  const after = [hourly[0] + moved * early, hourly[1] - moved, hourly[2] + moved * (1 - early)];
  const beforePeak = Math.max(...hourly), afterPeak = Math.max(...after);
  return {before: hourly, after, moved, total: sum(hourly), beforePeak, afterPeak,
    peakReduction: beforePeak - afterPeak,
    peakReductionShare: beforePeak ? (beforePeak - afterPeak) / beforePeak : null,
    afterPeakHour: 7 + after.indexOf(afterPeak), shiftPersonHours: moved};
}

export function shiftRoad(weights, policy, totalDemand = 3000) {
  if (!Array.isArray(weights) || weights.length !== 240 || weights.some(x => !Number.isFinite(x) || x < 0) || sum(weights) <= 0) {
    throw Error('A complete 240-minute profile is required');
  }
  if (!validShare(policy.share) || !validShare(policy.early) || ![30, 60].includes(policy.delay)
    || !Number.isFinite(totalDemand) || totalDemand < 0) throw Error('Invalid road redistribution');
  const arrivals = Array(300).fill(0), normalized = sum(weights);
  let shiftedDemand = 0;
  for (let t = 0; t < 240; t++) {
    const demand = weights[t] / normalized * totalDemand;
    // Only the pre-specified 17:30–18:30 window is eligible, not an optimized peak.
    const moved = policy.all || (t >= 60 && t < 120) ? demand * policy.share : 0;
    const early = moved * policy.early, late = moved - early;
    if (early && t - policy.delay < 0) throw Error('Cannot truncate early arrivals');
    arrivals[t] += demand - moved;
    if (early) arrivals[t - policy.delay] += early;
    arrivals[t + policy.delay] += late;
    shiftedDemand += moved;
  }
  return {arrivals, totalDemand, shiftedDemand, shiftVehicleHours: shiftedDemand * policy.delay / 60};
}

export function queueProfile(arrivals, capacity) {
  if (!Number.isFinite(capacity) || capacity <= 0) throw Error('Positive capacity required');
  let queue = 0, area = 0, served = 0, peakQueue = 0, lastQueueMinute = null;
  const series = [];
  for (let t = 0; t < arrivals.length + 120; t++) {
    const step = queueStep(queue, arrivals[t] || 0, capacity / 60);
    queue = step.queue; area += step.area; served += step.served;
    peakQueue = Math.max(peakQueue, queue);
    if (queue > 1e-7) lastQueueMinute = t + 1;
    series.push({minute: t + 1, arrivals: arrivals[t] || 0, queue});
  }
  return {capacity, demand: sum(arrivals), served, residual: queue, peakQueue,
    queueVehicleHours: area / 60, lastQueueMinute, complete: queue < 1e-7, series};
}

export function runStaggered(input) {
  const daily = input.metro.daily.map(d => ({day: d.day,
    hourly: [0, 1, 2].map(i => sum(d.stations.map(s => s.hourly[i])))}));
  const hourly = [0, 1, 2].map(i => sum(daily.map(d => d.hourly[i])) / daily.length);
  const metro = {daily, hourly, cases: [0, .05, .1, .2].flatMap(share => [0, .5].map(early => ({
    share, early, aggregate: shiftHourly(hourly, share, early),
    days: daily.map(d => ({day: d.day, ...shiftHourly(d.hourly, share, early)}))
  })))};
  const road = input.ramp.days.map(d => ({day: d.day, complete: d.complete,
    cases: d.complete && d.relative_weights ? [600, 750, 900].flatMap(capacity => staggerPolicies.map(policy => {
      const {arrivals, ...shifted} = shiftRoad(d.relative_weights, policy);
      return {policy: policy.id, ...shifted, ...queueProfile(arrivals, capacity)};
    })) : []}));
  return {metro, road};
}
