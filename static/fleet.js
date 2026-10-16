import {number,resultCards} from './ui.js';
const $=id=>document.getElementById(id),n=(x,d=0)=>number(x,d);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let data,selected={share:.2,roundTrip:30},routes,map,layer,markers=[];
const maximum=(r,key)=>Math.max(0,...r.stations.map(s=>s[key]??0));
function showCell(cell){
 selected={share:cell.share,roundTrip:cell.roundTrip};
 document.querySelectorAll('.fleet-cell').forEach(el=>el.setAttribute('aria-pressed',String(+el.dataset.share===cell.share&&+el.dataset.trip===cell.roundTrip)));
 const r=cell.recommended,b=cell.baseline;
 $('fleet-verdict').textContent=r.feasible?`假設 ${n(cell.share*100)}% 乘客需要接駁，一圈行駛停靠 ${cell.roundTrip} 分鐘、另留 10 分鐘休息，需要 ${r.totalFleet} 輛（${r.activeFleet} 出勤＋${r.reserveFleet} 備車）才能通過全部 ${r.testedDays} 天及測試到站偏移。`:'測試的班距中找不到通過所有條件的方案；不是證明任何方案都不可行。';
 $('fleet-metrics').innerHTML=r.feasible?[
  ['合計車數（含備車）',n(r.totalFleet)+' 輛'],['通過日期',`${r.passedDays} / ${r.testedDays} 天`],
  ['各站最高候車 P95',n(maximum(r,'worstP95'),1)+' 分'],['各站最多未上車',n(maximum(r,'maxUnserved'))+' 人']
 ].map(([label,value])=>`<article><span>${label}</span><strong>${value}</strong></article>`).join(''):'';
 $('fleet-stations').innerHTML=r.feasible?r.stations.map(s=>`<article><h4>${esc(s.station)}</h4><p><b>${s.activeFleet} 輛出勤＋${s.reserveFleet} 輛備車</b><br>每 ${s.headway} 分鐘一班</p><p>跨日、偏移的最高候車 P95：${n(s.worstP95,1)} 分鐘<br>各次模擬均載完、無漏班</p><p class="fine">最高 P95 出現在 ${esc(s.worstP95Case?.day)}，到站偏移 ${s.worstP95Case?.phase} 分鐘。此處 P95 指 95% 已上車者等候不超過的時間。</p></article>`).join(''):'';
 $('fleet-baseline').textContent=`同樣條件下，固定 38 輛方案只有 ${b.passedDays} / ${b.testedDays} 天通過。各站、各日與偏移中，最高候車 P95 為 ${n(maximum(b,'worstP95'),1)} 分，最多仍有 ${n(maximum(b,'maxUnserved'))} 人未上車，最多 ${maximum(b,'maxMissed')} 班無車可發。各項最高值可能來自不同模擬，不能相加當成某一天的總量。`;
 resultCards($('fleet-compare'),[
  {title:'各站最高候車 P95',unit:' 分',note:'跨全部日期與偏移取最大；只含已上車者。',series:[{label:'維持 38 輛',value:maximum(b,'worstP95')},{label:'本格方案',value:r.feasible?maximum(r,'worstP95'):null}]},
  {title:'各站最多仍未上車',unit:' 人',note:'跨全部日期與偏移取最大；未上車者保留在結果中。',series:[{label:'維持 38 輛',value:maximum(b,'maxUnserved')},{label:'本格方案',value:r.feasible?maximum(r,'maxUnserved'):null}]}
 ]);
}
function renderGrid(){
 const interval=+$('fleet-arrival').value,cells=data.cells.filter(c=>c.arrivalInterval===interval);
 $('phase-note').textContent=interval?`每小時總人數不變，每 ${interval} 分鐘一批；從整點起每半分鐘測試一個偏移，共 ${interval*2} 種到站時間，全部都須通過。這是人潮壓力假設，不是實際捷運班距。`:'每半分鐘均分該小時人數，沒有集中下車。進站後一律延後 30 分鐘抵達是假設。';
 $('fleet-heat').querySelector('thead').innerHTML='<tr><th scope="col">接駁比例 ↓<br>行駛停靠 →</th>'+data.roundTrips.map(t=>`<th scope="col">${t} 分鐘</th>`).join('')+'</tr>';
 $('fleet-heat').querySelector('tbody').innerHTML=data.shares.map(share=>`<tr><th scope="row">${n(share*100)}%</th>${data.roundTrips.map(trip=>{
  const c=cells.find(c=>c.share===share&&c.roundTrip===trip),v=c.recommended.totalFleet;
  const color=v===null?'#666':v<=40?'#34796a':v<=70?'#216352':v<=110?'#174c42':'#102f29';
  return `<td><button class="fleet-cell" data-share="${share}" data-trip="${trip}" aria-pressed="false" style="background:${color}" aria-label="接駁比例 ${share*100}%，行駛停靠 ${trip} 分鐘，${v===null?'未找到方案':v+' 輛含備車'}">${v??'—'}<small>${v===null?'未找到方案':'輛（含備車）'}</small></button></td>`;
 }).join('')}</tr>`).join('');
 document.querySelectorAll('.fleet-cell').forEach(el=>el.addEventListener('click',()=>showCell(cells.find(c=>c.share===+el.dataset.share&&c.roundTrip===+el.dataset.trip))));
 showCell(cells.find(c=>c.share===selected.share&&c.roundTrip===selected.roundTrip));
}
const nearMetro=s=>/捷運西湖|捷運港墘/.test(s.StopName.Zh_tw);
const position=s=>{const p=s.StopPosition;return p&&Number.isFinite(p.PositionLat)&&Number.isFinite(p.PositionLon)?[p.PositionLat,p.PositionLon]:null;};
function showRoute(){
 const r=routes.routes[+$('route-choice').value],stops=[...r.Stops].sort((a,b)=>a.StopSequence-b.StopSequence);
 const transfers=stops.filter(nearMetro);
 $('route-summary').textContent=`${r.SubRouteName?.Zh_tw||r.RouteName.Zh_tw}，${stops[0].StopName.Zh_tw} → ${stops.at(-1).StopName.Zh_tw}，${stops.length} 個官方站序紀錄。${transfers.length?'包含西湖／港墘接駁候選站。':'沒有名稱直接對應西湖／港墘的站，供外圍服務比較；步行轉乘須另查。'}線形更新：${(r.reference_time||'未知').replace('T',' ')}。`;
 $('route-candidate').textContent=transfers.length?'現勘候選：沿既有站序比較西湖／港墘到瑞光路、公館山、麗寶大樓、時報廣場的接駁。先核對目的地、可停靠空間、可否折返與司機休息設施；尚未證明一條線能載走兩站所有接駁者。':'此路線供瑞光路與外圍捷運接駁比較。沒有把它直接當作西湖／港墘接駁線，也未把其他捷運站的人次加進本輪模型。';
 if(layer){
  layer.clearLayers();markers=[];
  if($('route-line').checked&&(r.geometry||r.reference_geometry))L.geoJSON({type:'Feature',geometry:r.geometry||r.reference_geometry,properties:{}},{style:{color:'#476a86',weight:4,dashArray:r.geometry?null:'8 8',opacity:.65}}).addTo(layer);
  stops.forEach(s=>{
   const p=position(s);if(!p)return;
   const marker=L.circleMarker(p,{radius:nearMetro(s)?11:7,color:'#fff',weight:2,fillOpacity:1,fillColor:nearMetro(s)?'#a94a12':'#16634f'}).addTo(layer);
   marker.bindTooltip(String(s.StopSequence),{permanent:true,direction:'right',className:'stop-sequence'}).bindPopup(`<b>${s.StopSequence}. ${esc(s.StopName.Zh_tw)}</b><br>${esc(r.SubRouteName?.Zh_tw||r.RouteName.Zh_tw)}<br>官方站點；停靠、折返與休息空間待確認`);
   markers.push({sequence:s.StopSequence,marker,position:p});
  });
 }
 $('route-stops').innerHTML=stops.map(s=>`<li value="${s.StopSequence}"><button data-stop="${s.StopSequence}" ${map?'':'disabled'}>${esc(s.StopName.Zh_tw)}<small>${position(s)?position(s).map(v=>v.toFixed(5)).join(', '):'位置缺測'}</small></button></li>`).join('');
 $('route-stops').querySelectorAll('button').forEach(button=>button.addEventListener('click',()=>{const m=markers.find(m=>m.sequence===+button.dataset.stop);if(m){map.setView(m.position,16);m.marker.openPopup();$('fleet-map').scrollIntoView({behavior:'smooth',block:'center'});}}));
}
async function load(url){const r=await fetch(url);if(!r.ok)throw Error('資料讀取失敗（HTTP '+r.status+'）');return r.json();}
// Independent sections: one failed input must not erase the other section.
async function initFleet(){try{
 data=await load('data/simulation/fleet-experiment.json');renderGrid();$('fleet-arrival').disabled=false;$('fleet-output').hidden=false;
 $('fleet-arrival').addEventListener('change',renderGrid);
}catch(e){$('fleet-error').hidden=false;$('fleet-error').textContent=e.message;$('fleet-output').hidden=true;}}
async function initRoutes(){try{
 routes=await load('data/simulation/route-candidates.json');
 if(window.L){map=L.map('fleet-map',{scrollWheelZoom:false}).setView([25.076,121.574],14);layer=L.layerGroup().addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>{$('tile-note').hidden=false;}).addTo(map);
 }else{$('tile-note').hidden=false;$('tile-note').textContent='地圖元件無法載入，請閱讀下方完整站序。';}
 $('route-choice').innerHTML=routes.routes.map((r,i)=>`<option value="${i}">${esc(r.SubRouteName?.Zh_tw||r.RouteName.Zh_tw)} · ${esc(r.Stops[0].StopName.Zh_tw)} → ${esc(r.Stops.at(-1).StopName.Zh_tw)}（方向 ${r.Direction}）</option>`).join('');
 $('route-choice').disabled=false;showRoute();$('route-choice').addEventListener('change',showRoute);$('route-line').addEventListener('change',showRoute);
 $('route-fit').disabled=!map;$('route-local').disabled=!map;
 $('route-fit').addEventListener('click',()=>{if(map&&markers.length)map.fitBounds(markers.map(m=>m.position),{padding:[30,30]});});
 $('route-local').addEventListener('click',()=>map?.setView([25.076,121.574],14));
}catch(e){$('route-error').hidden=false;$('route-error').textContent=e.message;}}
await Promise.all([initFleet(),initRoutes()]);
