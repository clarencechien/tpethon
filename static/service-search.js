import {number} from './ui.js';
const $ = id => document.getElementById(id);
const n = (x, d = 0) => x == null ? '—' : number(Math.abs(x) < 0.5 * 10 ** -d ? 0 : x, d);
const avg = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
const desc = c => c ? `${c.fleet}輛＋1輛備車，緩衝${c.buffer}分` : '這20種設定中找不到';
let data, current;

function render() {
  const group = data.groups.find(g => g.condition.railPeople === Number($('search-people').value)
    && g.condition.trainHeadway === Number($('search-headway').value));
  const target = Number($('search-target').value);
  const selection = group.selections.find(s => s.target === target);
  current = {group, target};
  const trial = selection.candidate ? group.trials.find(t => t.candidate.id === selection.candidate.id) : null;
  const reference = group.trials[0].rows;
  const brtGain = avg(reference.map(r => r.brt.gain));
  const brtCost = avg(reference.map(r => r.brt.incrementalCost));
  const passes = selection.validation.filter(r => r.passes).length;
  $('search-verdict').textContent = trial
    ? `有費用較低的候選：${desc(selection.candidate)}。挑選時平均省${n(selection.training.meanGain, 1)}分鐘；換旅客並加入延誤後，${passes}／12次達標。${passes < 12 ? '目前還不能說這份班表可靠。' : '此結果仍只適用於所測條件。'}`
    : `希望保留${target * 100}%省時效果：這20種設定沒有通過全部挑選門檻。不能把最好看的一筆當成可行方案。`;
  $('search-pick').textContent = trial
    ? `基準為2輛營運車＋1輛備車；候選增加${selection.candidate.fleet - 2}輛營運車。BRT比較條件為4輛＋1輛備車。這是搜尋範圍內費用最低的達標設定，不是已核准車隊。`
    : '沒有選中方案，所以不發布它的驗證成績；下方仍保留全部候選與未達標結果。';
  const bars = [{label: '原方式（2輛，假設班表）', value: 0},
    ...(trial ? [{label: '選中的混流接駁', value: selection.training.meanGain}] : []),
    {label: 'BRT行駛條件（4輛，假設）', value: brtGain}];
  const max = Math.max(1, ...bars.map(b => b.value));
  $('search-bars').innerHTML = bars.map(b => `<div class="metric-row"><div class="metric-label"><span>${b.label}</span><strong>省${n(b.value, 1)}分鐘</strong></div><div class="metric-track" aria-hidden="true"><div class="metric-fill" style="width:${Math.max(0, b.value / max * 100)}%"></div></div></div>`).join('');
  $('search-cost').textContent = `${trial ? `候選每晨新增約${n(selection.training.meanCost)}元；` : ''}BRT條件每晨新增約${n(brtCost)}元，其中12,000元是假設的設施分攤。${trial ? `若只比較營運、先不計設施，候選相對BRT營運費差約${n(selection.training.meanCost - (brtCost - 12000))}元。` : ''}每車小時1,200元、至少3小時含備車，超時另計；不是報價，不能把較便宜當成已證實。`;
  $('search-grid').querySelector('tbody').innerHTML = [2, 3, 4, 5, 6].map(fleet => `<tr><th>${fleet}輛＋1備</th>${[0, 2, 5, 8].map(buffer => {
    const t = group.trials.find(t => t.candidate.fleet === fleet && t.candidate.buffer === buffer);
    const harm = t.summary.maxNewlyLate > 0 || t.summary.maxUnserved > 0;
    const chosen = t.candidate.id === selection.candidate?.id;
    return `<td class="${harm ? 'harm' : ''} ${chosen ? 'selected' : ''}" title="最多新增晚到${t.summary.maxNewlyLate}人，未完成${t.summary.maxUnserved}人">${n(t.summary.meanGain, 1)}${harm ? ' ！' : ''}${chosen ? ' ✓' : ''}</td>`;
  }).join('')}</tr>`).join('');
  $('search-validation-verdict').textContent = trial
    ? `${passes}／12次通過全部門檻。最多有${Math.max(...selection.validation.map(r => r.mixed.newlyLate))}人，比同樣遭遇延誤的原方式新增晚到。這是換旅客後的驗證，不是挑選時的成績。`
    : '未選出方案，沒有驗證成績；請切換條件或省時目標，查看有候選的組別。';
  $('search-validation').querySelector('tbody').innerHTML = trial ? data.disturbances.map(d => {
    const rows = selection.validation.filter(r => r.disturbance === d.id);
    return `<tr><th>${d.label}</th><td>${rows.filter(r => r.passes).length}／3</td><td>${n(avg(rows.map(r => r.mixed.gain)), 1)}分</td><td>${Math.max(...rows.map(r => r.mixed.newlyLate))}人</td><td>${Math.max(...rows.map(r => r.mixed.unserved))}人</td><td>${Math.max(...rows.map(r => r.brt.newlyLate))}人</td></tr>`;
  }).join('') : '<tr><td colspan="6">沒有選中的方案，不把缺少驗證當成零人晚到。</td></tr>';
}

try {
  const response = await fetch('data/simulation/service-search-results.json');
  if (!response.ok) throw Error(`HTTP ${response.status}`);
  data = await response.json();
  render();
  $('search-overview').querySelector('tbody').innerHTML = data.groups.map(g => `<tr><th>${g.condition.railPeople}人／${g.condition.trainHeadway}分</th>${g.selections.map(s => `<td>${desc(s.candidate)}</td><td>${s.candidate ? `${s.validation.filter(r => r.passes).length}／12` : '未執行'}</td>`).join('')}</tr>`).join('');
  for (const id of ['search-people', 'search-headway', 'search-target']) $(id).onchange = render;
  $('search-content').hidden = false;
  $('search-download').onclick = () => {
    const blob = new Blob([JSON.stringify({source_sha256: data.source_sha256, trainingSeeds: data.trainingSeeds,
      validationSeeds: data.validationSeeds, disturbances: data.disturbances, ...current}, null, 2)], {type: 'application/json'});
    const url = URL.createObjectURL(blob), a = document.createElement('a');
    a.href = url; a.download = 'neihu-e12-service-search.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
} catch (error) {
  $('search-content').hidden = true;
  $('search-error').hidden = false;
  $('search-error').textContent = `無法載入實驗結果：${error.message}。不以零或假資料填補。`;
}
