import {busPlan} from './plan_logic.js';
const $=id=>document.getElementById(id),n=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const pct=v=>Number.isFinite(v)?(v*100).toFixed(1)+'%':'—';
let manifest,weeks=[];
async function readWeek(entry){
 if(!/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.file))throw Error('週摘要檔名不符');
 const r=await fetch('./data/weeks/'+entry.file,{cache:'no-cache'});if(!r.ok)throw Error('週摘要讀取失敗（HTTP '+r.status+'）');
 const buffer=await r.arrayBuffer();if(buffer.byteLength!==entry.bytes)throw Error('週摘要大小與索引不符');
 const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
 if(hash!==entry.sha256)throw Error('週摘要版本不一致，請重新整理');
 return JSON.parse(new TextDecoder().decode(buffer));
}
async function read(url){const r=await fetch(url);if(!r.ok)throw Error('資料讀取失敗（HTTP '+r.status+'）');return r.json();}
function renderWeeks(){
 if(!manifest)return;const period=$('week-period').value;
 $('weekly-period').textContent=`截至 ${manifest.as_of} · 上週是完整週期，本週只計已發布歷史；最新排程快照不混入週摘要。`;
 $('week-cards').replaceChildren();
 for(const [i,w] of weeks.entries()){
  const box=n('article','');box.className='week-card';box.append(n('b',(i===0?'上週':'本週')+' · '+w.start+' – '+w.end),n('strong',w.available_days+' / 7 天'),n('p',w.complete?'七個日曆日皆已取得；每日仍可能有觀測缺漏。':'部分週：未發布、未來或下載缺漏日期不補零。'));$('week-cards').append(box);
 }
 const m=manifest.matched_weekdays[period];
 $('matched-comparison').textContent=m.day_pairs.length?`同星期配對 ${m.day_pairs.length} 組、${m.paired_bins} 個時間格：上週 ${pct(m.previous.slow_share)} → 本週 ${pct(m.current.slow_share)} 低速觀測；差 ${m.difference_percentage_points>=0?'+':''}${m.difference_percentage_points.toFixed(1)} 個百分點。這是觀測差異，尚未控制天氣或其他因素。`:'共同日期與有效觀測不足，不能比較兩週。';
 $('weekly-hotspots').replaceChildren();
 for(const [i,w] of weeks.entries()){
  const box=n('article','');box.className='week-card';box.append(n('b',i===0?'上週候選':'本週候選'));
  const candidates=w.hotspot_candidates?.[period]||[];
  for(const c of candidates.slice(0,5))box.append(n('p',`${c.road} ${c.direction||''} · ${pct(c.hot_share)} · ${c.observed_days} 天`));
  if(!candidates.length)box.append(n('p','沒有足夠有效觀測可列出候選。'));$('weekly-hotspots').append(box);
 }
 $('daily-rows').replaceChildren();
 for(const w of weeks)for(const d of w.days){
  const p=d.periods?.[period],row=n('tr',''),label={available:'已取得',future:'未來日期',not_yet_published:'官方歷史未發布',missing:'資料缺漏'}[d.status];
  const calendar=d.reference_holiday===true?(d.calendar_note||'休假參考'):'週'+['','一','二','三','四','五','六','日'][d.weekday];
  for(const value of [d.day,label+' · '+calendar,p?`${p.covered_bins}/${p.expected_bins}`:'—',pct(p?.slow_share),pct(p?.hot_share),'未核對'])row.append(n('td',value));$('daily-rows').append(row);
 }
}
function inputs(){return {people:Number($('people').value),shift:Number($('shift').value)/100,capacity:Number($('capacity').value),load:Number($('load').value)/100,peakMinutes:Number($('peak').value),cycleMinutes:Number($('cycle').value),carOccupancy:Number($('occupancy').value),reserve:Number($('reserve').value)/100};}
function renderPlan(){
 try{
  if([...$('scenario-form').elements].some(el=>el.tagName==='INPUT'&&(!el.value||!el.checkValidity())))throw Error('請填寫有效範圍內的數值');
  const args=inputs(),p=busPlan(args);$('scenario-error').hidden=true;$('scenario-results').replaceChildren();
  for(const [label,value,note] of [['改搭巴士',p.passengers,'假設人次'],['每小時發車',p.departuresPerHour,'班／小時'],['營運車輛',p.operatingFleet,'輛'],['含備車',p.totalFleet,`其中備車 ${p.reserveFleet} 輛`],['換算少開私車',Math.round(p.hypotheticalRemovedCarTrips),'假設汽車旅次，非實測去重車流'],['每班有效容量',p.effectiveCapacity,'規劃人數，非實際載客']]){
   const box=n('article','');box.className='plan-result';box.append(n('span',label),n('strong',value.toLocaleString('zh-TW')),n('small',note));$('scenario-results').append(box);
  }
  $('sensitivity').replaceChildren();for(const cycleMinutes of [...new Set([60,args.cycleMinutes,120])].sort((a,b)=>a-b)){
   const plan=busPlan({...args,cycleMinutes}),row=n('tr','');for(const value of [cycleMinutes+' 分鐘',plan.departuresPerHour,plan.operatingFleet,plan.totalFleet])row.append(n('td',value));$('sensitivity').append(row);
  }
 }catch(e){$('scenario-error').hidden=false;$('scenario-error').textContent=e.message;$('scenario-results').replaceChildren();$('sensitivity').replaceChildren();}
}
$('week-period').onchange=renderWeeks;$('scenario-form').oninput=renderPlan;$('scenario-form').onsubmit=e=>e.preventDefault();renderPlan();
(async()=>{try{manifest=await read('./data/weeks/index.json');weeks=await Promise.all(manifest.weeks.map(readWeek));renderWeeks();}catch(e){$('weekly-error').hidden=false;$('weekly-error').textContent=e.message+'；目前無法判讀週摘要。';}})();
read('./data/simulation/readiness.json').then(d=>{for(const item of d.items){const row=n('div','');row.className='readiness-row';row.append(n('b',item.label+' · '+item.status),n('p',item.detail));$('readiness').append(row);}}).catch(e=>$('readiness').textContent=e.message);
