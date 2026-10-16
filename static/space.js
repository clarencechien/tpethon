import {spaceDefaults,simulateSpace,vehicleState,validateSpace} from './space_logic.js';
import {number,resultCards} from './ui.js';
const $=id=>document.getElementById(id),n=(v,d=0)=>number(v,d),clock=t=>`${String(Math.floor((450+t)/60)).padStart(2,'0')}:${String((450+t)%60).padStart(2,'0')}`;
const fields={berths:'berths',restSpaces:'restspaces',dwell:'dwell',extra:'extra',share:'share',fleet:'fleet',reserve:'reserve',roundTrip:'roundtrip',rest:'rest'};
let data,artifact,currentOptions,currentResult,worker,trace;
const max=(rows,key)=>Math.max(0,...rows.map(r=>r[key]??0));
function fill(a){for(const [key,id] of Object.entries(fields))$('space-'+id).value=a[key]*(key==='share'?100:1);}
function read(){const a={...spaceDefaults};for(const [key,id] of Object.entries(fields)){const value=$('space-'+id).value;if(value.trim()==='')throw Error('請填寫完整數值；空白不代表零。');a[key]=Number(value)/(key==='share'?100:1);}validateSpace(a);return a;}
function show(result,envelope,a){
 currentResult=result;currentOptions=a;const p=result.plan;
 $('space-input-error').hidden=true;$('space-output').hidden=false;
 $('space-verdict').textContent=p.feasible?`每站從預定 ${a.desiredHeadway} 分一班調整為 ${n(p.headway,1)} 分一班。套用 ${n(a.share*100)}% 接駁需求，${result.passedDays} / ${result.testedDays} 天通過候車與載完條件。這是場地假設下的結果，還不是現地可行證明。`:'在測試的 2–60 分班距內，沒有符合車數、上下客與休息候發空間的班表。乘客仍保留在未服務人數，不把缺場地當成沒有需求。';
 $('space-metrics').innerHTML=[['每站實際投入',`${p.activeFleet} 輛`],['每站另需外部停車',`${p.offsiteParking} 格`],['跨日最高等待上限（95%）',result.stations.some(s=>s.worstP95!==null)?n(max(result.stations,'worstP95'),1)+' 分':'未有人離站'],['單站最多仍未離站',n(max(result.stations,'maxUnserved'))+' 人']].map(([label,value])=>`<article><span>${label}</span><strong>${value}</strong></article>`).join('');
 $('space-parking').textContent=p.feasible?`每站用 ${p.activeFleet} 輛輪轉，其餘 ${p.unusedFleet} 輛未投入＋${a.reserve} 輛備車，需另外 ${p.offsiteParking} 個停車位，沒有假設停在捷運站旁。休息區最多同時 ${p.peakRest} 輛（${a.extra?'設於遠端':'設於站旁'}），每圈除 ${a.rest} 分休息，還含 ${n(p.padding,1)} 分候發；上下客最多 ${p.peakBerths} 輛。保留全部車輛時，兩站外部停車需求合計 ${2*p.offsiteParking} 格。`:`出勤上限與備車合計每站 ${a.fleet+a.reserve} 輛，均需另處停放。沒有可運行班表。`;
 $('space-envelope').textContent=envelope.highestTestedShare===null?'測試的 5–40% 接駁比例，沒有一組能讓全部日期、兩站都通過。這不等於零運量，可能是班距太長或人潮太集中。':`在相同場地與車隊條件下，最高通過全部日期的測試比例為 ${n(envelope.highestTestedShare*100)}%。這不是實際轉乘率，也不保證所有更細的比例或未來日期都通過。`;
 $('space-envelope-chart').innerHTML=envelope.shares.map(r=>`<article class="${r.passed?'pass':''}"><strong>${n(r.share*100)}%</strong>${r.passedDays} / ${result.testedDays} 天通過</article>`).join('');
 $('space-status').textContent='已完成全部日期與到站偏移的檢查。';renderDay();
}
function renderDay(){
 if(!currentOptions||$('space-output').hidden)return;
 const day=data.metro.daily.find(d=>d.day===$('space-day').value),a={...currentOptions,arrivalPhase:+$('space-phase').value};
 trace=day.stations.map(s=>simulateSpace(s,a));
 $('space-day-note').textContent=`${day.day}：${n(trace.reduce((s,r)=>s+r.demand,0))} 人估計需要接駁。以下只看偏移 ${a.arrivalPhase} 分鐘的這一次模擬；上方跨日判定已檢查全部 12 種偏移。`;
 resultCards($('space-day-cards'),[
  {title:'到 11:30 還未離站',unit:' 人',note:'包括尚在候車及正在上車者，不會消失。',series:trace.map(r=>({label:r.station,value:r.unserved}))},
  {title:'95% 已離站者的等待上限',unit:' 分',note:'含上下客時間；未離站者不在這項統計內。',series:trace.map(r=>({label:r.station,value:r.p95Wait}))}
 ]);
 chart(trace);renderVehicles();
}
function chart(rows){
 const colors=['#17695a','#a54c20'],w=820,h=300,l=70,r=25,t=25,b=45;
 const maxY=Math.max(1,...rows.flatMap(s=>s.series.map(p=>p.waiting))),end=rows[0].series.at(-1).minute;
 const x=v=>l+v/end*(w-l-r),y=v=>h-b-v/maxY*(h-t-b);
 let svg=`<svg viewBox="0 0 ${w} ${h}" role="img" aria-label="兩站尚未開始上車人數隨時間變化"><title>尚未開始上車的人數（每分鐘取點）</title>`;
 for(let i=0;i<=4;i++){const value=maxY*i/4;svg+=`<line x1="${l}" x2="${w-r}" y1="${y(value)}" y2="${y(value)}" stroke="#d4ded7"/><text x="${l-10}" y="${y(value)+6}" text-anchor="end">${n(value)}</text>`;}
 for(let i=0;i<=4;i++)svg+=`<text x="${x(end*i/4)}" y="${h-12}" text-anchor="middle">${clock(end*i/4)}</text>`;
 rows.forEach((s,i)=>{svg+=`<polyline fill="none" stroke="${colors[i]}" stroke-width="3" points="${s.series.map(p=>`${x(p.minute)},${y(p.waiting)}`).join(' ')}"/>`;});
 $('space-queue-chart').innerHTML='<p>縱軸：候車人數；橫軸：模擬時間</p>'+svg+'</svg><div class="space-line-key">'+rows.map((s,i)=>`<span><i style="background:${colors[i]}"></i>${s.station}</span>`).join('')+'</div>';
}
function renderVehicles(){
 if(!currentResult)return;
 const t=+$('space-time').value,p=currentResult.plan,a=currentOptions,state=vehicleState(p,a,t);
 $('space-time-label').textContent=clock(t);
 $('space-vehicles').innerHTML=[['每站上下客',`${state.boarding} / ${a.berths} 格`,'固定上下客占用'],['每站休息＋候發',`${state.resting} / ${a.restSpaces} 格`,a.extra?'遠端休息場地':'站旁休息場地'],['每站分配的行駛車',`${state.road} 輛`,'包含額外空駛'],['每站外部停車',`${p.offsiteParking} 輛`,'未投入車輛與備車']].map(([label,value,note],i)=>`<article class="${i===3?'outside':''}">${label}<strong>${value}</strong><small>${note}</small></article>`).join('');
 $('space-vehicle-note').textContent=`這是每站各自一組、相同場地假設的車輛配置，不是兩站共用停車場。每站四類合計 ${a.fleet+a.reserve} 輛。假設已在 07:30 前預先調度至行駛、停靠、休息各階段；開庫、收班與場地位置仍待驗證。`;
}
function cancel(){if(worker){worker.terminate();worker=null;}$('run-space').disabled=false;}
function preset(id){cancel();const c=artifact.cases.find(r=>r.id===id);const a={...spaceDefaults,...c};fill(a);$('space-case').value=id;show(c.result,c.envelope,a);}
function run(){
 cancel();$('space-output').hidden=true;$('space-input-error').hidden=true;
 try{
  const a=read();$('space-status').textContent='正在檢查 22 天、12 種到站時間，以及 5–40% 需求…';$('run-space').disabled=true;
  worker=new Worker(new URL('./space_worker.js',import.meta.url),{type:'module'});
  worker.onmessage=({data:response})=>{cancel();if(response.error){fail(response.error);return;}show(response.result,response.envelope,a);};
  worker.onerror=()=>{cancel();fail('計算程式無法執行，請重新整理或改看上方固定情境。');};
  worker.postMessage({days:data.metro.daily,options:a});
 }catch(e){fail(e.message);}
}
function fail(message){$('space-input-error').hidden=false;$('space-input-error').textContent=message;$('space-output').hidden=true;$('space-status').textContent='尚未產生有效的新結果。';}
try{
 const readData=async url=>{const r=await fetch(url);if(!r.ok)throw Error(`資料讀取失敗（HTTP ${r.status}）`);return r.json();};
 [data,artifact]=await Promise.all([readData('data/simulation/service-inputs.json'),readData('data/simulation/space-experiment.json')]);
 $('space-case').innerHTML=artifact.cases.map(c=>`<option value="${c.id}">${c.label}</option>`).join('');$('space-case').disabled=false;
 $('space-comparison').querySelector('tbody').innerHTML=artifact.cases.map(c=>`<tr><th scope="row"><button data-case="${c.id}">${c.label}</button></th><td>${n(c.result.plan.headway,1)} 分</td><td>${c.result.passedDays} / ${c.result.testedDays} 天</td><td>${c.result.plan.offsiteParking} 格</td></tr>`).join('');
 $('space-day').innerHTML=data.metro.daily.map(d=>`<option value="${d.day}">${d.day}</option>`).join('');
 const total=d=>d.stations.reduce((s,r)=>s+r.hourly.reduce((x,y)=>x+y,0),0);$('space-day').value=[...data.metro.daily].sort((a,b)=>total(b)-total(a))[0].day;
 $('space-phase').innerHTML=Array.from({length:12},(_,i)=>`<option value="${i/2}">${i/2} 分鐘</option>`).join('');$('space-phase').value='0.5';
 preset('one');$('space-case').addEventListener('change',()=>preset($('space-case').value));
 document.querySelectorAll('[data-case]').forEach(button=>button.addEventListener('click',()=>{preset(button.dataset.case);$('try').scrollIntoView({behavior:'smooth'});}));
 $('run-space').addEventListener('click',run);$('space-day').addEventListener('change',renderDay);$('space-phase').addEventListener('change',renderDay);$('space-time').addEventListener('input',renderVehicles);
 for(const id of Object.values(fields))$('space-'+id).addEventListener('input',()=>{cancel();$('space-output').hidden=true;$('space-status').textContent='設定已變更，請按「重新試算全部 22 天」。';});
}catch(e){$('space-error').hidden=false;$('space-error').textContent=e.message;$('space-output').hidden=true;$('space-status').textContent='無法讀取資料，沒有顯示舊結果。';}
