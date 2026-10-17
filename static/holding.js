import {number} from './ui.js';
const $ = id => document.getElementById(id), n = (v, d = 0) => number(Math.abs(v) < .5 * 10 ** -d ? 0 : v, d);
const avg = a => a.reduce((s, x) => s + x, 0) / a.length;
const rowsFor = (cases, limit) => cases.map(c => c.results.find(r => r.limit === limit));
let data;
function render() {
  const id = $('holding-condition').value, walk = Number($('holding-walk').value);
  const cases = data.cases.filter(c => c.condition === id && c.predictedWalk === walk);
  const actualWalk = 6 + (cases[0].options.walkDelay || 0);
  $('holding-context').textContent = `本組實際步行假設${actualWalk}分鐘，控制器預估${walk}分鐘。原兩車班表準時率為${n(Math.min(...cases.map(c => c.base.onTimeShare)) * 100, 1)}%–${n(Math.max(...cases.map(c => c.base.onTimeShare)) * 100, 1)}%。下方是四車班表；觀察期限與到達期限維持不變。`;
  $('holding-bars').innerHTML = data.protocol.holdLimits.map(limit => {
    const rows = rowsFor(cases, limit), lo = Math.min(...rows.map(r => r.onTimeShare)), hi = Math.max(...rows.map(r => r.onTimeShare));
    return `<div class="metric-row"><div class="metric-label"><span>${limit ? `最多等${limit}分鐘` : '不等車'}：準時比例</span><strong>${n(lo * 100, 1)}%–${n(hi * 100, 1)}%</strong></div><div class="metric-track" aria-hidden="true"><div class="metric-fill ${lo < .95 ? 'bad' : ''}" style="width:${lo * 100}%"></div></div></div>`;
  }).join('');
  $('holding-detail').querySelector('tbody').innerHTML = data.protocol.holdLimits.map(limit => {
    const rows = rowsFor(cases, limit);
    return `<tr><th>${limit}分鐘</th><td>${n(avg(rows.map(r => r.gainVersusNoHold)), 2)}分</td><td>${Math.max(...rows.map(r => r.newlyLateVersusNoHold))}人</td><td>${n(Math.max(...rows.map(r => r.onboardHoldPersonMinutes)), 1)}</td><td>${Math.max(...rows.map(r => r.unserved))}人</td><td>${rows.filter(r => r.readyPass).length}／10</td></tr>`;
  }).join('');
}
try {
  const response = await fetch('data/simulation/holding-results.json');
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  data = await response.json();
  $('holding-summary').querySelector('tbody').innerHTML = data.protocol.holdLimits.map(limit => {
    const rows = rowsFor(data.cases, limit);
    return `<tr><th>${limit ? `${limit}分鐘` : '不等車'}</th><td>${rows.filter(r => r.passes).length}／100</td><td>${rows.filter(r => r.readyPass).length}／100</td><td>${Math.max(...rows.map(r => r.newlyLateVersusNoHold))}人</td></tr>`;
  }).join('');
  const zero = rowsFor(data.cases, 0).filter(r => r.readyPass).length;
  const six = rowsFor(data.cases, 6).filter(r => r.readyPass).length;
  $('holding-stop-verdict').textContent = `不等車通過${zero}／100次，最多等6分鐘通過${six}／100次。沒有任何一種規則在全部固定條件下通過，暫不推薦直接試辦這份班表。`;
  $('holding-condition').innerHTML = data.conditions.map(c => `<option value="${c.id}">${c.label}</option>`).join('');
  $('holding-condition').value = 'combined';
  $('holding-condition').onchange = render;
  $('holding-walk').onchange = render;
  const audit = data.audit.results.find(r => r.limit === 4);
  $('holding-audit-bar').innerHTML = [['earlier', audit.earlier], ['later', audit.later], ['same', audit.unchanged]].map(([cls, count]) => `<div class="${cls}" style="width:${count / 240 * 100}%"></div>`).join('');
  $('holding-audit-verdict').textContent = `${audit.earlier}人較早到、${audit.later}人較晚到、${audit.unchanged}人不變；其中${audit.newlyLateVersusNoHold}人從原本準時變成晚到。${audit.onboardHeldPeople}名已上車旅客累計多等${n(audit.onboardHoldPersonMinutes, 1)}人分鐘。這些代價已計入全程時間。`;
  render();
  $('holding-content').hidden = false;
} catch (error) {
  $('holding-content').hidden = true;
  $('holding-error').hidden = false;
  $('holding-error').textContent = `無法載入結果：${error.message}。不以零人晚到或假資料填補。`;
}
