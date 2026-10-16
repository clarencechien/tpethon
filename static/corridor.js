const $ = id => document.getElementById(id);
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock = stamp => stamp?.slice(11,16) || '—';
const direction = d => ({N:'北向',S:'南向',E:'東向',W:'西向',NE:'東北向',NW:'西北向',SE:'東南向',SW:'西南向'}[d] || d || '方向未知');
const color = speed => speed == null ? '#c5cece' : speed < 20 ? '#b83b36' : speed < 40 ? '#ce7720' : speed < 60 ? '#dfbf53' : '#378877';
let data, period, rows=[], selected=0, time=12, map, layer;
function label(row) { return row.sensor.name + (row.sensor.group==='city' ? ' '+direction(row.sensor.direction)+' · '+row.sensor.vd_id : ''); }
function changeGroup() {
  $('city-road-field').hidden=$('experiment-group').value!=='city';
  const names=[...new Set(period.rows.filter(r=>r.sensor.group==='city').map(r=>r.sensor.name))].sort();
  const previous=$('city-road').value;
  $('city-road').innerHTML=names.map(n=>`<option>${escape(n)}</option>`).join('');
  if(names.includes(previous)) $('city-road').value=previous;
  else if(names.includes('堤頂大道')) $('city-road').value='堤頂大道';
  render();
}
function render() {
  const group=$('experiment-group').value;
  rows=period.rows.filter(r=>r.sensor.group===group && (group!=='city'||r.sensor.name===$('city-road').value));
  selected=0;
  const valid=rows.reduce((s,r)=>s+r.summary.valid,0), expected=rows.reduce((s,r)=>s+r.summary.expected,0);
  $('period-coverage').textContent=group==='city'&&!period.city_available ? '本實驗未收錄這個日期的市區晨間資料。國道有資料，不能替代市區。' : `${period.label} · ${rows.length} 個方向別測點 · 有效 ${valid} / ${expected} 筆預定觀測。`;
  $('group-explanation').textContent=group==='city' ? '市區每 15 分鐘採樣；中間的「—」是未抽樣，不是順暢。紅燈也會造成低速，需核對路口。' : group==='ramps' ? '匝道彼此不一定相連；入口／出口與南北方向分開判讀。匝道儀控也可能造成低速。' : `${group==='south'?'南向里程由小到大':'北向里程由大到小'}，沿行車方向從上往下讀。色格是每 5 分鐘抽樣，不是這 5 分鐘的平均。`;
  $('experiment-heatmap').querySelector('thead').innerHTML='<tr><th scope="col">測點位置 ↓／時間 →</th>'+period.times.map((t,i)=>`<th scope="col">${i%3===0?clock(t):''}</th>`).join('')+'</tr>';
  $('experiment-heatmap').querySelector('tbody').innerHTML=rows.map((r,i)=>`<tr><th scope="row"><button data-row="${i}">${i+1}. ${escape(label(r))}</button></th>${r.values.map((v,j)=>{
    const unsampled=group==='city'&&j%3!==0;
    const description=`${label(r)}，${clock(period.times[j])}，${unsampled?'未抽樣':v?.speed==null?'無有效車速':v.speed+' 公里每小時'}，觀測時間 ${v?.time||'無'}`;
    return `<td><button class="heat-cell ${unsampled?'unsampled':v?.speed==null?'missing-cell':v.speed>=40&&v.speed<60?'light':''}" style="background:${color(v?.speed)}" data-row="${i}" data-time="${j}" aria-label="${escape(description)}" title="${escape(description)}">${unsampled?'—':v?.speed==null?'?':Math.round(v.speed)}</button></td>`;
  }).join('')}</tr>`).join('');
  $('heatmap-wrap').hidden=!rows.length;
  $('candidate-list').innerHTML='';
  const candidates=data.recurrent.filter(c=>c.period===period.period&&c.sensor.group===group&&(group!=='city'||c.sensor.name===$('city-road').value));
  $('candidate-empty').hidden=!!candidates.length;
  for(const c of candidates) {
    const current=rows.findIndex(r=>r.sensor.id===c.sensor.id);
    const card=document.createElement('article');
    card.innerHTML=`<h3>${escape(c.sensor.name)}${group==='city'?' '+escape(direction(c.sensor.direction)):''}</h3><p><b>${c.hit_days} / ${c.observed_days} 個資料足夠的${c.period==='am'?'上班':'下班'}日</b>，出現相鄰低速且高占有率觀測。</p><p>${c.days.map(d=>`${d.day.slice(5)}：${clock(d.first_run_time)}${d.first_run_left_censored?'（首筆就慢，開始時間未知）':' 起首次觀察到相鄰符合條件的快照'}`).join('<br>')}</p>${current>=0?`<button class="candidate-button" data-candidate="${current}">在圖上查看</button>`:''}`;
    $('candidate-list').append(card);
  }
  updateTime(true);
}
function updateTime(fit=false) {
  $('experiment-time').value=time;
  $('experiment-time-label').textContent=clock(period.times[time])+'（目標觀測時點）';
  $('time-prev').disabled=time===0;$('time-next').disabled=time===30;
  document.querySelectorAll('.heat-cell').forEach(el=>el.classList.toggle('selected',Number(el.dataset.time)===time));
  if(layer) {
    layer.clearLayers();
    rows.forEach((r,i)=>{
      const v=r.values[time];
      L.circleMarker([r.sensor.lat,r.sensor.lon],{radius:i===selected?13:10,color:i===selected?'#132d3b':'#fff',weight:2,fillOpacity:.9,fillColor:color(v?.speed)}).addTo(layer).bindTooltip(String(i+1),{className:'sensor-number'}).on('click',()=>{selected=i;updateTime();});
    });
    if(fit&&rows.length) map.fitBounds(rows.map(r=>[r.sensor.lat,r.sensor.lon]),{padding:[30,30],maxZoom:14});
  }
  showDetail();
}
function showDetail() {
  if(!rows.length) { $('experiment-detail').innerHTML='<h3>這組沒有可顯示測點</h3><p>請選擇其他道路或日期；沒有資料不等於順暢。</p>';return; }
  const r=rows[selected],v=r.values[time],s=r.summary;
  const unsampled=r.sensor.group==='city'&&time%3!==0;
  const reason=unsampled?'此時點原本未抽樣':v?.reason?({invalid_time:'來源時間無法解析',stale:'來源時間與目標相差超過 90 秒',invalid_status:'設備回報狀態異常',no_active_valid_lane:'沒有可用的活動車道車速',invalid_or_inactive:'設備、車速或活動車道條件不符'}[v.reason]||'來源資料異常'):v?'有效觀測':'此時點未取得這個測點的資料';
  $('experiment-detail').innerHTML=`<h3>${selected+1}. ${escape(label(r))}</h3><p class="experiment-number">${unsampled?'未抽樣':v?.speed==null?'無有效車速':v.speed+' km/h'}</p><dl><dt>實測時間</dt><dd>${escape(v?.time?.replace('T',' ')||'無')}</dd><dt>資料狀態</dt><dd>${escape(reason)}</dd><dt>占有率</dt><dd>${v?.occupancy==null?'未知':v.occupancy+'%'}</dd><dt>本時段有效</dt><dd>${s.valid} / ${s.expected} 筆</dd><dt>低速觀測</dt><dd>${s.low} / ${s.valid} 筆（低於 ${s.speed_threshold} km/h）</dd><dt>首次相鄰跡象</dt><dd>${s.first_run_time?clock(s.first_run_time)+(s.first_run_left_censored?'；首筆就慢，開始時間未知':' 起相鄰快照符合條件'):'未觀察到相鄰兩筆符合條件'}</dd><dt>最長相鄰組</dt><dd>${s.longest_run_samples} 筆，首末相隔 ${s.longest_run_span_minutes} 分鐘；非連續排隊時長</dd></dl><p class="experiment-sensor-id">測站：${escape(r.sensor.id)}</p>${r.sensor.metadata_time?`<p class="fine">位置資料更新：${escape(r.sensor.metadata_time)}</p>`:''}`;
}
function findings() {
  const records=data.periods.reduce((sum,p)=>sum+p.rows.reduce((n,r)=>n+r.summary.valid,0),0);
  const highwayPoints=new Set(data.periods.flatMap(p=>p.rows.filter(r=>r.sensor.provider==='NFB').map(r=>r.sensor.id))).size;
  const am=data.recurrent.filter(c=>c.period==='am'&&c.sensor.group!=='city').length;
  const city=data.recurrent.filter(c=>c.sensor.group==='city').length;
  $('experiment-summary').textContent=`本次資料快照 ${data.generated_at.slice(0,10)}：完成 5 個尖峰時段、${highwayPoints} 個國道／匝道方向別測點與市區資料的對照，共 ${records.toLocaleString('zh-TW')} 筆有效觀測。不是政策成效模擬。`;
  const ramp=data.recurrent.find(c=>c.sensor.vd_id==='VD-N1-S-16-I-WS-1-內湖-成功路'&&c.period==='pm');
  const rampTimes=ramp?ramp.days.map(d=>`${d.day.slice(5)} ${clock(d.first_run_time)}`).join('、'):'本次無符合條件的重複候選';
  $('experiment-findings').innerHTML=`<article><h3>成功路接國道南向入口</h3><p class="experiment-number">${ramp?.hit_days||0} 天重複出現</p><p>${escape(rampTimes)} 起，觀察到相鄰低速且高占有率快照。先核對匝道儀控、設備與下游回堵。</p></article><article><h3>國道南向，先查下游</h3><p>10/14、10/15 早上，21.39 公里比 18.71 公里更早出現相鄰跡象。但中間 20 公里沒有一致順序、16.3 公里缺有效觀測，尚不能確認回堵傳播。</p><p>晨間國道／匝道共 ${am} 個反覆候選；請沿路逐點檢查。</p></article><article><h3>市區也有反覆跡象</h3><p class="experiment-number">${city} 組測點 × 時段</p><p>市區在 10/14、10/15 重複出現的候選包含新明路、陽光街與堤頂大道。上班／下班分開計；本實驗未收錄 10/16 早上市區資料。</p></article>`;
  $('sensitivity-note').textContent='門檻敏感度（全部測點 × 上／下班時段）：'+data.sensitivity.map(s=>`主線 <${s.main_threshold}、其他 <${s.other_threshold} km/h 時，${s.count} 組重複候選`).join('；')+'。占有率門檻同為 25%。這是篩選範圍，不是政策效果或信賴區間。';
}
try {
  const response=await fetch('data/simulation/corridor-experiment.json');if(!response.ok)throw Error('資料讀取失敗 HTTP '+response.status);data=await response.json();
  $('experiment-period').innerHTML=[...data.periods].reverse().map(p=>`<option value="${p.id}">${p.label}</option>`).join('');$('experiment-period').disabled=false;
  period=data.periods.find(p=>p.id===$('experiment-period').value);
  if(window.L) {
    map=L.map('experiment-map',{scrollWheelZoom:false}).setView([25.075,121.59],13);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).addTo(map).on('tileerror',()=>{$('experiment-map-warning').hidden=false;});
    layer=L.layerGroup().addTo(map);
  } else $('experiment-map-warning').hidden=false;
  findings();changeGroup();
  document.querySelectorAll('[data-preset]').forEach(button=>button.addEventListener('click',()=>{
    const ramps=button.dataset.preset==='ramps';
    $('experiment-period').value=ramps?'2026-10-15-pm':'2026-10-14-am';
    period=data.periods.find(p=>p.id===$('experiment-period').value);
    $('experiment-group').value=button.dataset.preset;changeGroup();
    const index=rows.findIndex(r=>r.sensor.vd_id===(ramps?'VD-N1-S-16-I-WS-1-內湖-成功路':'VD-N1-S-21.390-M-LOOP'));
    selected=Math.max(0,index);time=ramps?3:2;updateTime();$('explore').scrollIntoView({behavior:'smooth'});
  }));
  $('experiment-period').addEventListener('change',()=>{period=data.periods.find(p=>p.id===$('experiment-period').value);changeGroup();});
  $('experiment-group').addEventListener('change',changeGroup);$('city-road').addEventListener('change',render);
  $('experiment-time').addEventListener('input',e=>{time=Number(e.target.value);updateTime();});
  $('time-prev').addEventListener('click',()=>{time=Math.max(0,time-1);updateTime();});$('time-next').addEventListener('click',()=>{time=Math.min(30,time+1);updateTime();});
  $('experiment-heatmap').addEventListener('click',e=>{const button=e.target.closest('button[data-row]');if(!button)return;selected=Number(button.dataset.row);if(button.dataset.time!==undefined)time=Number(button.dataset.time);updateTime();});
  $('candidate-list').addEventListener('click',e=>{const button=e.target.closest('[data-candidate]');if(!button)return;selected=Number(button.dataset.candidate);const stamp=rows[selected].summary.first_run_time;if(stamp){const slot=period.times.findIndex(t=>clock(t)===clock(stamp));if(slot>=0)time=slot;}updateTime();$('experiment-detail').scrollIntoView({behavior:'smooth',block:'center'});});
} catch(error) { $('experiment-error').hidden=false;$('experiment-error').textContent='實驗結果尚未載入：'+error.message;$('experiment-summary').textContent='無法確認結果，請稍後重新整理。'; }
