import {bars, element, number} from './ui.js';
const $ = id => document.getElementById(id), n = (v, d = 1) => number(Math.abs(v) < .5 * 10 ** -d ? 0 : v, d);
let data;
function metro() {
  const day = $('stagger-day').value, share = Number($('stagger-share').value), early = Number($('stagger-early').value);
  const c = data.metro.cases.find(c => c.share === share && c.early === early);
  const r = day === 'mean' ? c.aggregate : c.days.find(d => d.day === day);
  $('stagger-metro-verdict').textContent = `在原08–09時進站人次中，再移動${n(share * 100, 0)}%，約${n(r.moved, 0)}人次，占這三小時合計${n(r.total ? r.moved / r.total * 100 : 0)}%。最高小時人次由${n(r.beforePeak, 0)}變成${n(r.afterPeak, 0)}，變動${n(r.peakReductionShare === null ? 0 : -r.peakReductionShare * 100)}%；三小時總人次仍為${n(r.total, 0)}。這不是少開了多少車。`;
  $('stagger-metro-chart').replaceChildren();
  const scale = Math.max(1, ...r.before, ...r.after);
  for (const c of [{title: '現況：實際進站時段', note: day === 'mean' ? '22個週一至五平均，未排除假日。' : day + '，實際進站人次。', values: r.before},
    {title: '假設：在現況上再移動', note: '兩圖使用相同刻度；非實測政策效果。', values: r.after}]) {
    const card = element('article'); card.className = 'result-card';
    card.append(element('h3', c.title), element('p', c.note));
    const chart = element('div');
    bars(chart, c.values.map((value, i) => ({label: `${i + 7}:00–${i + 8}:00進站`, value})), {unit: ' 人次', max: scale});
    card.append(chart); $('stagger-metro-chart').append(card);
  }
  const changes = c.days.filter(d => d.peakReductionShare !== null).map(d => d.peakReductionShare * 100);
  $('stagger-daily-range').textContent = `同一新增移動假設套用22個日期，最高小時人次減少幅度介於${n(Math.min(...changes))}%與${n(Math.max(...changes))}%。負值表示反而增加；這是各日算術情境，不是政策效果信賴區間。`;
}
function chart(base, chosen) {
  const W = 820, H = 300, L = 70, R = 25, T = 20, B = 45;
  const max = Math.max(1, base.peakQueue, chosen.peakQueue), end = base.series.length;
  const x = t => L + t / end * (W - L - R), y = q => H - B - q / max * (H - T - B);
  let svg = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="假設排隊車數隨時間的變化"><title>假設排隊車數，非實測</title>`;
  for (let i = 0; i <= 4; i++) {
    const v = max * i / 4;
    svg += `<line x1="${L}" y1="${y(v)}" x2="${W - R}" y2="${y(v)}" stroke="#d9e2dc"/><text x="${L - 8}" y="${y(v) + 5}" text-anchor="end">${n(v, 0)}</text>`;
  }
  for (let t = 0; t <= end; t += 60) {
    const m = 990 + t;
    svg += `<text x="${x(t)}" y="${H - 12}" text-anchor="middle">${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}</text>`;
  }
  for (const [i, r] of [base, chosen].entries()) svg += `<polyline fill="none" stroke="${i ? '#b34e23' : '#17695a'}" stroke-width="3" ${i ? 'stroke-dasharray="8 4"' : ''} points="${[[0, 0], ...r.series.map(p => [p.minute, p.queue])].map(([t, q]) => `${x(t)},${y(q)}`).join(' ')}"/>`;
  $('stagger-queue-chart').innerHTML = `<p class="service-chart-title">假設排隊車數（輛），總車數不減少</p>${svg}</svg><div class="line-legend"><span><i style="background:#17695a"></i>原型態：實線</span><span><i style="background:#b34e23"></i>所選調整：虛線</span></div>`;
}
function road() {
  const day = data.road.find(d => d.day === $('stagger-road-day').value);
  $('stagger-road-output').hidden = !day.complete;
  $('stagger-road-gap').hidden = day.complete;
  if (!day.complete) { $('stagger-road-gap').textContent = '10/14原始241筆中只有239筆有效流量；停止套用此日，沒有補零。'; return; }
  const capacity = Number($('stagger-capacity').value), rows = day.cases.filter(r => r.capacity === capacity);
  const base = rows.find(r => r.policy === 'baseline'), chosen = rows.find(r => r.policy === $('stagger-policy').value);
  const delta = chosen.queueVehicleHours - base.queueVehicleHours;
  $('stagger-road-verdict').textContent = `假設每小時可通過${capacity}輛，這次移動約${n(chosen.shiftedDemand, 0)}輛的時段。總排隊由${n(base.queueVehicleHours)}變成${n(chosen.queueVehicleHours)}車時，${Math.abs(delta) < 1e-7 ? '沒有減少' : delta > 0 ? '反而增加' + n(delta) + '車時' : '減少' + n(-delta) + '車時'}。最多排隊由${n(base.peakQueue, 0)}變成${n(chosen.peakQueue, 0)}輛。${chosen.complete ? '' : '仍有車未通過，累計等待只是下限。'}這些都是假設機制，不是現況預測。`;
  chart(base, chosen);
  $('stagger-road-table').querySelector('tbody').innerHTML = rows.map(r => `<tr><th>${data.policies.find(p => p.id === r.policy).label}</th><td>${n(r.shiftedDemand, 0)}</td><td>${r.complete ? '' : '≥ '}${n(r.queueVehicleHours)}</td><td>${n(r.peakQueue, 0)}</td><td>${n(r.residual, 0)}</td></tr>`).join('');
}
try {
  const response = await fetch('data/simulation/staggered-results.json');
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  data = await response.json();
  $('stagger-day').innerHTML = '<option value="mean">22個週一至五平均（未排除假日）</option>' + data.metro.daily.map(d => `<option>${d.day}</option>`).join('');
  $('stagger-road-day').innerHTML = data.road.map(d => `<option value="${d.day}">${d.day} ${d.complete ? '完整' : '缺測：不模擬'}</option>`).join('');
  $('stagger-road-day').value = '2026-10-15';
  $('stagger-policy').innerHTML = data.policies.filter(p => p.id !== 'baseline').map(p => `<option value="${p.id}">${p.label}</option>`).join('');
  $('stagger-policy').value = 'split10';
  for (const id of ['stagger-day', 'stagger-share', 'stagger-early']) $(id).onchange = metro;
  for (const id of ['stagger-road-day', 'stagger-capacity', 'stagger-policy']) $(id).onchange = road;
  metro(); road(); $('stagger-content').hidden = false;
} catch (error) {
  $('stagger-content').hidden = true; $('stagger-error').hidden = false;
  $('stagger-error').textContent = `無法載入資料：${error.message}。不以假資料補齊。`;
}
