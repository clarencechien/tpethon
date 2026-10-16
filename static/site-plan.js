import {number} from './ui.js';
const $=id=>document.getElementById(id),n=(v,d=0)=>number(v,d),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let sites,services,map,layer,plan,service;
const point=s=>[s.StopPosition.PositionLon,s.StopPosition.PositionLat],latlon=p=>[p[1],p[0]];
const osm=p=>`https://www.openstreetmap.org/?mlat=${p[1]}&mlon=${p[0]}#map=18/${p[1]}/${p[0]}`;
function sourceLink(id){const s=sites.sources.find(s=>s.id===id);return `<a href="${esc(s.url)}" target="_blank" rel="noopener">官方原始資料</a>`;}
function fit(){if(map&&plan){map.invalidateSize({pan:false});map.fitBounds([point(plan.boarding_start),point(plan.alighting_terminal),sites.facilities.find(s=>s.id===plan.base_id).coordinates].map(latlon),{padding:[45,45],maxZoom:15,animate:false});}}
function facilityDetail(id,pan=false){
 const f=sites.facilities.find(s=>s.id===id);
 $('site-detail').innerHTML=`<h3>${esc(f.name)}</h3><p class="site-status">${esc(f.status_label)} · 可承租名額尚未確認</p><dl><dt>地址</dt><dd>${esc(f.address)}</dd><dt>官方登載大型車位</dt><dd>${f.large_vehicle_bays} 格（全場總數，不是空位）</dd><dt>來源服務時間</dt><dd>${esc(f.service_time)}</dd><dt>來源費率</dt><dd>${esc(f.fees)}</dd><dt>定位方式</dt><dd>${esc(f.coordinate_basis)}</dd></dl><p>${esc(f.note)}</p><p>尚未確認：可承租數、入口與轉彎空間、接駁上下客許可、司機休息室及廁所。</p><p><a href="${osm(f.coordinates)}" target="_blank" rel="noopener">在 OpenStreetMap 查看資料點</a> · ${sourceLink('parking')}</p>`;
 if(pan&&map){map.setView(latlon(f.coordinates),16);$('site-map').scrollIntoView({behavior:'smooth',block:'center'});}
}
function stopDetail(s,role,pan=false){
 const p=point(s);
 $('site-detail').innerHTML=`<h3>${esc(role)}：${esc(s.StopName.Zh_tw)}</h3><p>官方方向別公車站牌位置，坐標 ${p[1].toFixed(6)}, ${p[0].toFixed(6)}。這不是已確認的捷運出口、接駁專用月台或休息位置。</p><p>接駁使用同意、可停靠長度、行人空間與實際上下客時間都待核對。公車到此的合法道路不能推導出可在此直接迴轉。</p><p><a href="${osm(p)}" target="_blank" rel="noopener">在 OpenStreetMap 查看站牌位置</a> · <a href="data/simulation/site-plan.json">站點來源與代碼</a></p>`;
 if(pan&&map){map.setView(latlon(p),17);$('site-map').scrollIntoView({behavior:'smooth',block:'center'});}
}
function drawMap(){
 if(!layer)return;layer.clearLayers();
 for(const [key,color] of [['outbound_reference','#176858'],['return_reference','#386aa1']]){
  const g=plan[key];L.geoJSON({type:'Feature',properties:{},geometry:{type:g.type,coordinates:g.coordinates}},{style:{color,weight:5,opacity:.8,dashArray:'10 5'}}).addTo(layer);
 }
 if($('site-car-routes').checked)for(const g of plan.gaps){
  if(g.car_reference)L.geoJSON({type:'Feature',properties:{},geometry:g.car_reference.geometry},{style:{color:'#a35824',weight:4,dashArray:'3 7',opacity:.85}}).addTo(layer).bindTooltip('一般汽車路由，非大客車核定動線');
 }
 for(const f of sites.facilities){
  const color={priority:'#774a92',alternative:'#526c9c',conditional:'#b66b1b',excluded:'#737e79'}[f.status];
  L.circleMarker(latlon(f.coordinates),{radius:f.id===plan.base_id?13:9,color:'#fff',weight:2,fillColor:color,fillOpacity:.95}).addTo(layer)
   .bindTooltip(f.id===plan.base_id?'主基地候選：行善六場':f.name,{permanent:f.id===plan.base_id,direction:'bottom',className:'site-pin'})
   .on('click',()=>facilityDetail(f.id));
 }
 const roles=plan.proposed_stops.map((s,i)=>({s,role:i===0?'起站／上客':i===plan.proposed_stops.length-1?'末站／下客':'辦公區下客',label:i===0?'起：'+plan.station:i===plan.proposed_stops.length-1?'終：時報廣場':String(i+1)}));
 roles.push({s:plan.return_start,role:'回程參考起點',label:'回程起點'},{s:plan.return_terminal,role:'回程參考終點',label:'回程終點'});
 for(const {s,role,label} of roles){L.circleMarker(latlon(point(s)),{radius:9,color:'#fff',weight:2,fillColor:role.startsWith('回程')?'#386aa1':'#176858',fillOpacity:1}).addTo(layer)
  .bindTooltip(label,{permanent:!role.startsWith('回程'),direction:'right',className:'site-pin'}).on('click',()=>stopDetail(s,role));}
 fit();
}
function renderRoute(){
 plan=sites.plans.find(p=>p.id===$('site-route').value);service=services.plans.find(p=>p.id===plan.id);
 $('site-route-summary').textContent=`${plan.name}：晨間在捷運${plan.station}站外候選站位上客，於四個辦公區站點下客，末站為時報廣場。基地位於行善路263號對面。去程主線參考段約 ${n(plan.outbound_reference.length_m/1000,2)} 公里，回程約 ${n(plan.return_reference.length_m/1000,2)} 公里；未包含基地與折返接續，不能當成完整往返里程。`;
 $('site-flow').innerHTML=[['1 起站上客','捷運'+plan.station+'站','既有方向別站牌候選'],['2 辦公區下客','瑞光路 → 時報廣場','四個擬下客點'],['3 基地休息','行善六場','車位與設施待洽'],['4 回程接續','時報廣場 → '+plan.station,'兩端折返道路待確認']].map(([title,value,note])=>`<article><span>${title}</span><b>${esc(value)}</b><small>${note}</small></article>`).join('');
 const stops=plan.proposed_stops.map((s,i)=>({s,role:i===0?'起站：上客':`第 ${i} 個下客點`}));
 stops.push({s:plan.return_start,role:'回程起點：另一側站牌'},{s:plan.return_terminal,role:'回程終點：另一側站牌'});
 $('site-stops').innerHTML=stops.map(({s,role},i)=>`<article><span class="tag">${role}</span><h3>${esc(s.StopName.Zh_tw)}</h3><small>${point(s)[1].toFixed(6)}, ${point(s)[0].toFixed(6)}</small><button data-stop="${i}">查看位置與限制</button></article>`).join('');
 $('site-stops').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>{const r=stops[+b.dataset.stop];stopDetail(r.s,r.role,true);}));
 $('site-gaps').innerHTML=plan.gaps.map((g,i)=>`<article><h3>${i+1}. ${esc(g.label)}</h3><p>兩個資料點直線相隔約 ${n(g.straight_line_m)} 公尺。實際大客車行車距離、入口與通行尚未驗證。</p>${g.car_reference?`<p>一般汽車路由約 ${n(g.car_reference.distance_m)} 公尺。未限制站牌離站方向，基地端點也未確認是入口；不能作為大客車折返依據。<a href="${esc(g.car_reference.source.url)}" target="_blank" rel="noopener">路由來源</a></p>`:''}</article>`).join('');
 const previous=$('site-scenario').value;
 $('site-scenario').innerHTML=service.scenarios.map(c=>`<option value="${c.id}">${esc(c.label)}</option>`).join('');if(service.scenarios.some(c=>c.id===previous))$('site-scenario').value=previous;
 $('site-scenarios').querySelector('tbody').innerHTML=service.scenarios.map(c=>{const r=c.result,s=r.stations[0];return `<tr><th scope="row">${esc(c.label)}</th><td>${n(r.plan.headway,1)} 分</td><td>${r.passedDays} / ${r.testedDays} 天</td><td>${n(s.worstP95,1)} 分</td><td>${n(s.maxUnserved)} 人</td></tr>`;}).join('');
 renderOperation();drawMap();facilityDetail(plan.base_id);
}
function renderOperation(){
 const c=service.scenarios.find(c=>c.id===$('site-scenario').value),r=c.result,p=r.plan,a=c.options,s=r.stations[0],fleet=a.fleet+a.reserve;
 $('site-operation-verdict').textContent=`${plan.station}線：${a.fleet} 輛出勤上限＋${a.reserve} 輛備車，調整為每 ${n(p.headway,1)} 分一班。假設 ${n(a.share*100)}% 乘客使用本線，${r.passedDays} / ${r.testedDays} 天通過。`+(r.passed?'這仍需要場地、路線和實測時間確認。':'這組條件未通過所有日期，不能當成足夠的服務方案。');
 $('site-operation-metrics').innerHTML=[['平均估計使用者',n(service.mean_journeys*a.share)+' 人／晨'],['本批最高需求日',n(service.max_journeys*a.share)+' 人／晨'],['最高離站等待（95%）',n(s.worstP95,1)+' 分'],['基地開收班需確認',fleet+' 格']].map(([label,value])=>`<article><span>${label}</span><strong>${value}</strong></article>`).join('');
 $('site-demand-note').textContent=`來源是 ${plan.station}目的站的 22 個週一至週五人次（未排除假日），並非這條線已量測的需求。先假設其中 ${n(a.share*100)}% 使用本線；是否前往四個辦公區、是否願意搭乘還需企業調查。模型抵達窗為 07:30–10:30，服務追蹤至 11:30。`;
 $('site-resources').innerHTML=[
 ['起站與下客','起站洽准 1 個獨立上客位；各下客點確認可停靠。末站不作休息或原地迴轉場地。'],
 ['基地休息與備車',`營運中配置 2 個休息候發位＋${a.reserve} 個備車位；此情境實際休息候發峰值 ${p.peakRest} 輛。司機休息室與廁所尚待查證。`],
 ['開收班與停車預算',`本情境需先確認 ${fleet} 格。依行善六場公開大客車月租每格 15,000 元試算，停車約 ${n(fleet*15000)} 元／月；不是報價，不含車輛、人力、燃料與設施。`],
 ['車程仍是假設',`一圈行駛及沿途停靠 ${a.roundTrip} 分，起點上下客 ${a.dwell} 分、休息 ${a.rest} 分，基地額外往返 ${a.extra} 分。未由參考線長推算尖峰車程。`]
 ].map(([title,text])=>`<article><h3>${title}</h3><p>${text}</p></article>`).join('');
}
async function load(path){const r=await fetch(path);if(!r.ok)throw Error(`資料 HTTP ${r.status}`);return r.json();}
try{
 [sites,services]=await Promise.all([load('data/simulation/site-plan.json'),load('data/simulation/site-service.json')]);
 $('site-content').hidden=false;
 if(window.L){map=L.map('site-map',{scrollWheelZoom:false});layer=L.layerGroup().addTo(map);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'}).on('tileerror',()=>{$('site-tile-error').hidden=false;}).addTo(map);
 }else{$('site-tile-error').hidden=false;$('site-tile-error').textContent='地圖元件無法載入，仍可查看下方站點坐標、設施與外部地圖連結。';}
 $('site-source-summary').textContent=`本次讀取 ${n(sites.parking_records_examined)} 筆臺北市停車場紀錄，內湖區登載大型車位大於零者有 ${sites.neihu_large_vehicle_facilities} 處。來源更新：${sites.as_of.replace('T',' ').replace('+08:00','（台北時間）')}。資料沒有提供本案可承租數。`;
 $('site-facilities').querySelector('tbody').innerHTML=sites.facilities.map(f=>`<tr><th scope="row"><button data-facility="${f.id}">${esc(f.name)}</button></th><td>${f.large_vehicle_bays} 格</td><td>尚未確認</td><td>${esc(f.status_label)}</td></tr>`).join('');
 $('site-facilities').querySelectorAll('button').forEach(b=>b.addEventListener('click',()=>facilityDetail(b.dataset.facility,true)));
 $('site-route').disabled=false;renderRoute();if(map)new ResizeObserver(()=>fit()).observe($('site-map'));$('site-car-routes').addEventListener('change',drawMap);$('site-route').addEventListener('change',renderRoute);$('site-scenario').addEventListener('change',renderOperation);
 $('site-fit').disabled=!map;$('site-all').disabled=!map;$('site-fit').addEventListener('click',fit);
 $('site-all').addEventListener('click',()=>map?.fitBounds(sites.facilities.map(f=>latlon(f.coordinates)),{padding:[40,40]}));
}catch(e){$('site-error').hidden=false;$('site-error').textContent='候選方案無法讀取：'+e.message;$('site-content').hidden=true;}
