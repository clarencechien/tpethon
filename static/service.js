import {simulateShuttles,recommendShuttles,rampScenarios,serviceDefaults,rampDefaults} from './service_logic.js';
import {resultCards,number} from './ui.js';
const $=id=>document.getElementById(id),n=(v,d=1)=>number(v,d);
const val=id=>{if($(id).value.trim()==='')throw Error('請填寫完整數值；空白不代表零。');return Number($(id).value);};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clock=(minute,base=420)=>{const t=Math.round(base+minute);return `${String(Math.floor(t/60)%24).padStart(2,'0')}:${String(t%60).padStart(2,'0')}`;};
let data;
function lineChart(target,series,{title,unit,base=420}){
 const colors=['#17695a','#b34e23','#4859a4','#8d3f7c'],width=820,height=290,left=65,right=20,top=25,bottom=45;
 const points=series.flatMap(s=>s.points),maxX=Math.max(1,...points.map(p=>p.x)),maxY=Math.max(1,...points.map(p=>p.y).filter(Number.isFinite));
 const x=t=>left+t/maxX*(width-left-right),y=v=>height-bottom-v/maxY*(height-top-bottom);
 let svg=`<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title>`;
 for(let i=0;i<=4;i++){const value=maxY*i/4;svg+=`<line x1="${left}" y1="${y(value)}" x2="${width-right}" y2="${y(value)}" stroke="#d9e2dc"/><text x="${left-8}" y="${y(value)+5}" text-anchor="end">${esc(n(value,0))}</text>`;}
 for(let i=0;i<=5;i++){const t=maxX*i/5;svg+=`<text x="${x(t)}" y="${height-12}" text-anchor="middle">${clock(t,base)}</text>`;}
 series.forEach((s,i)=>{
  let segment=[];const flush=()=>{if(segment.length)svg+=`<polyline fill="none" stroke="${colors[i%colors.length]}" stroke-width="3" points="${segment.join(' ')}"/>`;segment=[];};
  s.points.forEach(p=>{if(!Number.isFinite(p.y)){flush();return;}segment.push(`${x(p.x)},${y(p.y)}`);});flush();
 });
 svg+='</svg>';
 target.innerHTML=`<p class="service-chart-title">${esc(title)} · 縱軸：${esc(unit)}</p>${svg}<div class="line-legend">${series.map((s,i)=>`<span><i style="background:${colors[i%colors.length]}"></i>${esc(s.label)}</span>`).join('')}</div>`;
}
function shuttleOptions(){return {...serviceDefaults,share:val('shuttle-share')/100,capacity:val('shuttle-capacity'),headway:val('shuttle-headway'),fleet:val('shuttle-fleet'),roundTrip:val('shuttle-roundtrip'),travelLag:val('shuttle-lag'),rest:val('shuttle-rest'),load:val('shuttle-load')/100,reserve:val('shuttle-reserve')/100};}
function runShuttle(){
 try{
  $('shuttle-error').hidden=true;
  const day=$('shuttle-day').value,stations=day==='mean'?data.metro.mean_stations:data.metro.daily.find(d=>d.day===day).stations,a=shuttleOptions();
  $('share-value').textContent=n(a.share*100,0)+'%';
  const result=simulateShuttles(stations,a),unserved=result.unserved>1e-6;
  $('shuttle-verdict').textContent=`在這組假設下，約 ${n(result.demand,0)} 人需要接駁，兩站共配置 ${result.activeFleet} 輛出勤＋${result.reserveFleet} 輛備車。`+(unserved?`到 ${clock(result.results[0].serviceEnd)} 仍約 ${n(result.unserved,0)} 人未上車；不能只看已上車者的等候時間。`:result.demand<1e-7?'接駁需求為零。':`模型內全部上車，95% 已上車乘客等候不超過 ${n(result.p95Wait)} 分鐘。`);
  $('shuttle-metrics').innerHTML=[['估計接駁人數',n(result.demand,0)+' 人'],['平均候車（已上車）',n(result.meanWait)+' 分'],['結束仍未上車',n(result.unserved,0)+' 人'],['車不夠而未發出的班次',n(result.missedDepartures,0)+' 班']].map(([label,value])=>`<article><span>${label}</span><strong>${value}</strong></article>`).join('');
  lineChart($('shuttle-queue-chart'),result.results.map(r=>({label:r.station,points:r.series.map(p=>({x:p.minute,y:p.waiting}))})),{title:'模擬候車人數',unit:'人'});
  const scenarios=[['目前設定',a],['改用 20 人小巴',{...a,capacity:20}],['改為每 5 分一班',{...a,headway:5}],['往返多花 20 分',{...a,roundTrip:Math.min(180,a.roundTrip+20)}]].map(([label,options])=>({label,...simulateShuttles(stations,options)}));
  resultCards($('shuttle-comparison'),[
   {title:'95% 已上車乘客的候車上限',unit:' 分',note:'仍未上車者不在這個統計內，需一起看右圖。',series:scenarios.map(r=>({label:r.label,value:r.p95Wait}))},
   {title:'結束時仍未上車的人',unit:' 人',series:scenarios.map(r=>({label:r.label,value:r.unserved}))}
  ]);
  $('shuttle-comparison-note').textContent=`比較時兩站各維持 ${a.fleet} 輛出勤、相同需求；容量使用 ${n(a.load*100,0)}%，每圈另留 ${a.rest} 分休息／恢復。固定班距與每小時均勻到站是假設，沒有考慮列車到站的一波波人潮。`;
  resultCards($('metro-hour-charts'),stations.map(station=>({title:station.name+' 實際進站時段旅次',unit:' 人次',note:'目的地為此站；不是這個時間抵達此站。',series:station.hourly.map((value,i)=>({label:`${i+7}:00–${i+8}:00 進站`,value}))})));
  const daily=data.metro.daily.map(d=>simulateShuttles(d.stations,a));
  const passed=daily.filter(r=>r.results.every(s=>(s.demand<1e-7||s.p95Wait<=10)&&s.unserved<1e-7&&s.missedDepartures===0)).length;
  $('shuttle-robustness').textContent=`保持相同設定，分別代入本批 ${daily.length} 天需求，有 ${passed} 天兩站都能在模型內載完、無漏班且候車 P95 不超過 10 分。這是跨日需求壓力測試，不是現場服務品質驗證，也不保證未來；資料仍包含未排除的假日。`;
  const recommended=recommendShuttles(stations,a);
  $('shuttle-recommendation').textContent=recommended.map(r=>r.feasible?`${r.station}：${r.activeFleet} 輛出勤＋${r.reserveFleet||0} 輛備車${r.headway?`，每 ${r.headway} 分一班，候車 P95 約 ${n(r.p95Wait)} 分`:'，無接駁需求'}`:`${r.station}：${r.reason}`).join('；')+'。';
  $('shuttle-table').querySelector('tbody').innerHTML=result.results.map(r=>`<tr><th scope="row">${esc(r.station)}</th><td>${n(r.demand,0)}</td><td>${n(r.boarded,0)}</td><td>${n(r.unserved,0)}</td><td>${n(r.p95Wait)} 分</td><td>${r.missedDepartures}</td></tr>`).join('');
  $('shuttle-source-note').textContent=`參考：${day==='mean'?'22 個週一至週五的平均（未排除假日）':day+' 實際進站人次'}。07–10 時進站，假設 ${a.travelLag} 分鐘後到接駁站；營運從 ${clock(a.travelLag)} 至 ${clock(180+a.travelLag+a.tail)}。不含這批乘客以外的需求。`;
  $('shuttle-output').hidden=false;
 }catch(error){$('shuttle-error').hidden=false;$('shuttle-error').textContent=error.message;$('shuttle-output').hidden=true;}
}
function runRamp(){
 try{
  $('ramp-error').hidden=true;const day=data.ramp.days.find(d=>d.day===$('ramp-day').value);
  $('ramp-input-summary').textContent=`${day.day} 16:30–20:30：${day.valid_volume} / ${day.expected} 筆有效原始流量值，${day.valid_speed} 筆有效車速。${day.complete?'時間戳每分鐘連續。':'時窗不完整，停止套用，沒有補零。'}`;
  if(!day.complete||!day.relative_weights)throw Error('這一天有缺測或時間不連續，不能用整段型態模擬。請選擇完整日期。');
  const a={...rampDefaults,totalDemand:val('ramp-demand'),capacity:val('ramp-capacity'),initialQueue:val('ramp-initial')};
  const scenarios=rampScenarios(day.relative_weights,a),base=scenarios[0],shift=scenarios[5];
  const allClear=scenarios.every(r=>r.residual<1e-6);
  $('ramp-verdict').textContent=`假設這批共有 ${n(a.totalDemand,0)} 輛車、每小時可通過 ${n(a.capacity,0)} 輛，起始排隊 ${n(a.initialQueue,0)} 輛。`+(allClear?`基準總排隊 ${n(base.queueVehicleHours)} 車時；20% 延後 60 分後為 ${n(shift.queueVehicleHours)} 車時。`:'部分情境結束仍有車未通過；累計排隊只是截至結束的下限，不能用來排名。')+' 這些不是實測排隊，也未驗證能重現現況。';
  lineChart($('ramp-observation-chart'),[{label:'實測有效車速',points:day.observations.map((r,i)=>({x:i,y:r.speed}))}],{title:day.day+' 成功路南向入口',unit:'km/h',base:990});
  lineChart($('ramp-queue-chart'),[scenarios[0],scenarios[4],scenarios[5]].map(r=>({label:r.label,points:r.series.map(p=>({x:p.minute,y:p.queue}))})),{title:'假設情境的排隊車數',unit:'輛',base:990});
  resultCards($('ramp-comparison'),[
   {title:'總排隊車時',unit:' 車時',note:'尚有剩餘排隊者僅為觀測窗內累計下限。',series:scenarios.map(r=>({label:r.label,value:r.queueVehicleHours,lowerBound:r.residual>1e-6}))},
   {title:'結束時還沒通過的車',unit:' 輛',series:scenarios.map(r=>({label:r.label,value:r.residual}))}
  ]);
  const sensitivity=[.8,1,1.2].map(factor=>{const cap=a.capacity*factor,[b,,,,,s]=rampScenarios(day.relative_weights,{...a,capacity:cap});return `容量 ${n(cap,0)} 輛／時：基準 ${n(b.queueVehicleHours)}、延後 ${n(s.queueVehicleHours)} 車時${b.residual+s.residual>1e-6?'（仍有未通過車輛）':''}`;});
  $('ramp-sensitivity').textContent=sensitivity.join('；')+'。容量 ±20% 是假設壓力測試，不能稱為晴雨預測或信賴區間。';
  $('ramp-table').querySelector('tbody').innerHTML=scenarios.map(r=>`<tr><th scope="row">${r.label}</th><td>${r.residual>1e-6?'≥ ':''}${n(r.queueVehicleHours)}</td><td>${n(r.peakQueue)}</td><td>${n(r.removedDemand)}</td><td>${n(r.served)}</td><td>${n(r.residual)}</td></tr>`).join('');
  $('ramp-output').hidden=false;
 }catch(error){$('ramp-error').hidden=false;$('ramp-error').textContent=error.message;$('ramp-output').hidden=true;}
}
try{
 const response=await fetch('data/simulation/service-inputs.json');if(!response.ok)throw Error('輸入資料 HTTP '+response.status);data=await response.json();
 $('metro-input-summary').textContent=`${data.metro.month} 的 ${data.metro.weekdays} 個週一至週五，07–10 時進站且前往西湖／港墘，共 ${n(data.metro.total_journeys,0)} 人次。未排除假日；進站時間不是抵達時間。`;
 $('shuttle-day').innerHTML='<option value="mean">22 個週一至週五平均（含假日）</option>'+data.metro.daily.map(d=>`<option value="${d.day}">${d.day} · ${n(d.stations.reduce((s,r)=>s+r.hourly.reduce((a,b)=>a+b,0),0),0)} 人次</option>`).join('');
 $('shuttle-day').disabled=false;
 $('ramp-day').innerHTML=data.ramp.days.map(d=>`<option value="${d.day}">${d.day}${d.complete?' · 完整序列':' · 有缺測'}</option>`).join('');$('ramp-day').disabled=false;
 const full=data.ramp.days.find(d=>d.complete);if(full)$('ramp-day').value=full.day;
 runShuttle();runRamp();
 $('peak-day').addEventListener('click',()=>{const total=d=>d.stations.reduce((s,r)=>s+r.hourly.reduce((a,b)=>a+b,0),0);const peak=[...data.metro.daily].sort((a,b)=>total(b)-total(a))[0];$('shuttle-day').value=peak.day;runShuttle();});
 $('run-shuttle').addEventListener('click',runShuttle);$('run-ramp').addEventListener('click',runRamp);
 $('shuttle-day').addEventListener('change',runShuttle);$('ramp-day').addEventListener('change',runRamp);
 $('shuttle-share').addEventListener('input',runShuttle);
 document.querySelectorAll('#shuttle .service-controls input:not([type=range]),#shuttle .service-controls select:not(#shuttle-day)').forEach(el=>el.addEventListener('change',runShuttle));
 document.querySelectorAll('#ramp input').forEach(el=>el.addEventListener('change',runRamp));
}catch(error){$('service-error').hidden=false;$('service-error').textContent='實驗資料無法讀取：'+error.message;$('shuttle-output').hidden=true;$('ramp-output').hidden=true;}
