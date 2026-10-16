import {dataAvailability,scheduleMessage} from './availability.js';
import {decodeArchive,combineFrames} from './history.js';
import {classify,filtered,repeatedEvidence,color,PERIODS,taipeiParts,previousDay,frameTime,periodFrames,summarizePeriod,heatCells} from './logic.js';
const $=id=>document.getElementById(id);
const node=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const fmt=v=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:1}):'—';
const clock=value=>{const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat('zh-TW',{timeZone:'Asia/Taipei',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hour12:false}).format(d):'無來源時間';};
const labels={hot:'待查壅塞：低速＋高占有率',slow:'僅低速，需更多證據',normal:'未達熱點門檻',invalid:'無效或沒有活動車道',stale:'資料過期或時間異常'};
const bounds=[[25.045,121.54],[25.105,121.63]];
const map=L.map('map',{zoomControl:false,scrollWheelZoom:false}).fitBounds(bounds);
L.control.zoom({position:'topright'}).addTo(map);L.control.scale({imperial:false,position:'bottomright'}).addTo(map);
const tiles=L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">OpenStreetMap</a> contributors'}).addTo(map);
tiles.on('tileerror',()=>{$('tile-warning').hidden=false;});
const heatLayer=L.layerGroup().addTo(map),roadLayer=L.layerGroup(),busLayer=L.layerGroup(),metroLayer=L.layerGroup().addTo(map);
let data,metro,index=0,selectedId,markers=new Map(),mode='latest',playTimer=null;
let historyIndex={days:[]},selectionRequest=0;
const archives=new Map(),archiveRequests=new Map();
let recentFrames=[];
const latestIndex=()=>data.frames.findIndex(f=>(f.road.timestamp||f.captured_at)===(data.current.road.timestamp||data.current.captured_at));
const today=()=>taipeiParts(new Date().toISOString()).day;
const currentFilters=()=>({corridor:$('corridor').value,direction:$('direction').value,search:$('search').value});
const chosenFrames=()=>data?periodFrames(data.frames,$('observation-date').value,$('period').value):[];
const historical=()=>mode==='period';
const reference=()=>historical()&&selectedFrame()?Date.parse(selectedFrame().captured_at):Date.now();
const selectedFrame=()=>data?.frames[index];
function popupLine(root,label,value){const row=node('div',undefined,'popup-line');row.append(node('span',label),node('strong',value));root.append(row);}
function selectRoad(row){selectedId=row.id;const marker=markers.get(row.id);if(marker){map.setView(marker.getLatLng(),Math.max(map.getZoom(),15));L.popup().setLatLng(marker.getLatLng()).setContent(marker.getPopup().getContent()).openOn(map);}renderDetail(row);}
function renderDetail(row){const root=$('detail');root.replaceChildren();if(!row){const box=node('div');box.append(node('div','觀測依據','eyebrow'),node('h2','點選一個熱點，查看判讀依據。'),node('p','車速、占有率、車流與來源時間一起看；單張快照不能證明排隊原因。'));root.append(box);return;}
const box=node('div'),state=classify(row,reference()),evidence=repeatedEvidence(row.id,data.frames,index);
box.append(node('div',labels[state],'eyebrow'),node('h2',row.name+' · '+(row.direction||'方向未知')),node('p',`${row.vd_id} · Link ${row.link_id} · ${clock(row.timestamp)}`),node('p',`選定快照前一小時：${evidence.total} 次有效觀測，${evidence.hot} 次符合熱點門檻。${evidence.total<3?'樣本不足，尚不能判定持續性。':'離散快照不代表期間持續壅塞。'}`));
const metrics=node('div',undefined,'detail-grid');for(const [label,value] of [['車道平均車速 km/h',fmt(row.speed)],['平均占有率 %',fmt(row.occupancy)],['來源區間車輛觀測',fmt(row.volume)]]){const n=node('div');n.append(node('span',label),node('strong',value));metrics.append(n);}root.append(box,metrics);
const history=data.frames.slice(0,index+1).slice(-16).map(f=>({f,r:f.road.rows.find(r=>r.id===row.id)}));
if(history.length>1){const chart=node('div');chart.append(node('p','最近觀測的速度（每柱為一次快照，非連續時間）'));const bars=node('div',undefined,'trend');for(const {f,r} of history){const bar=node('span');const valid=r&&['hot','slow','normal'].includes(classify(r,Date.parse(f.captured_at)));bar.style.height=valid?Math.max(3,Math.min(65,r.speed))+'px':'3px';bar.style.background=valid?color(r,'evidence',Date.parse(f.captured_at)):'#657c74';bar.title=clock(f.captured_at)+' · '+(valid?fmt(r.speed)+' km/h':'缺漏或無效');bars.append(bar);}chart.append(bars);box.append(chart);}}
function render(){if(!data)return;const hasFrame=Boolean(selectedFrame());const f=selectedFrame()||{road:{rows:[]},captured_at:null};const ref=reference();const rows=filtered(f.road.rows,$('corridor').value,$('direction').value,$('search').value);const valid=rows.filter(r=>['hot','slow','normal'].includes(classify(r,ref)));const hot=valid.filter(r=>classify(r,ref)==='hot');const slow=valid.filter(r=>classify(r,ref)==='slow');
$('stat-valid').textContent=`${valid.length} / ${rows.length}`;$('stat-hot').textContent=valid.length?hot.length:'—';$('stat-slow').textContent=valid.length?slow.length:'—';
const isHistorical=historical();const sourceAge=Date.now()-Date.parse(data.current.road.timestamp);const stale=!Number.isFinite(sourceAge)||sourceAge>600000||sourceAge< -120000;
$('freshness').textContent=!hasFrame?'選定時段沒有資料':isHistorical?'歷史觀測回放':stale?'來源超過 10 分鐘或無有效資料':'來源時間在 10 分鐘內';$('freshness').classList.toggle('stale',stale||isHistorical);
$('source-time').textContent=hasFrame?'道路來源 '+clock(f.road.timestamp):$('observation-date').value+' · '+PERIODS[$('period').value].label;
$('map-heading').textContent=($('corridor').value||'內湖周邊')+' · '+(!hasFrame?'無觀測，不代表不塞':isHistorical?clock(f.road.timestamp):'最新已發布快照');
renderPeriodControls();
$('error').hidden=!f.road.error;if(f.road.error)$('error').textContent='道路來源讀取失敗：'+f.road.error;
roadLayer.clearLayers();heatLayer.clearLayers();markers=new Map();const groups=new Map();for(const r of rows){if(!groups.has(r.vd_id))groups.set(r.vd_id,[]);groups.get(r.vd_id).push(r.id);}
for(const r of rows){const state=classify(r,ref),fill=color(r,$('metric').value,ref),s=state==='hot'?24:19;const siblings=groups.get(r.vd_id),slot=siblings.indexOf(r.id),offset=siblings.length>1?(slot-(siblings.length-1)/2)*16:0;const deg={N:0,NE:45,E:90,SE:135,S:180,SW:225,W:270,NW:315}[r.bearing]??0;
const icon=L.divIcon({className:'vd-marker',html:`<svg width="${s}" height="${s}" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="${fill}" stroke="white" stroke-width="2"/><path d="M12 5 L16 12 H13 V18 H11 V12 H8Z" fill="white" transform="rotate(${deg} 12 12)"/></svg>`,iconSize:[s,s],iconAnchor:[s/2-offset,s/2]});
const marker=L.marker([r.lat,r.lon],{icon,keyboard:true,alt:r.name+' '+r.direction});const popup=node('div');popup.append(node('b',r.name+' · '+(r.direction||'方向未知')),node('p',labels[state]));popupLine(popup,'車速',fmt(r.speed)+' km/h');popupLine(popup,'占有率',fmt(r.occupancy)+'%');popupLine(popup,'來源區間車流',fmt(r.volume));popup.append(node('small',`${r.vd_id} · ${clock(r.timestamp)}`));marker.bindPopup(popup);marker.bindTooltip(node('span',r.name+' '+(r.direction||'')+' · '+fmt(r.speed)+' km/h'));marker.on('click',()=>{selectedId=r.id;renderDetail(r);});marker.addTo(roadLayer);markers.set(r.id,marker);}
for(const cell of heatCells(rows,ref,$('metric').value)){
 const box=node('div');box.append(node('b','400 公尺觀測網格'),node('p',`${cell.rows.length} 個有效方向觀測 · ${Math.round(cell.slowShare*100)}% 低速`));
 popupLine(box,'觀測點平均車速',fmt(cell.meanSpeed)+' km/h');popupLine(box,'符合熱點門檻',Math.round(cell.hotShare*100)+'%');
 box.append(node('small','色塊非道路邊界或排隊範圍；下方細節列出區塊內最低速觀測。'));
 const rect=L.rectangle(cell.bounds,{color:cell.fill,weight:1,fillColor:cell.fill,fillOpacity:cell.opacity}).bindPopup(box).addTo(heatLayer);
 rect.on('click',()=>{const r=[...cell.rows].sort((a,b)=>a.speed-b.speed)[0];selectedId=r.id;renderDetail(r);});
}
updateLayers();
$('ranking').replaceChildren();const rank=[...hot,...slow].sort((a,b)=>((classify(a,ref)==='hot'?0:1)-(classify(b,ref)==='hot'?0:1))||(a.speed-b.speed)||((b.occupancy||0)-(a.occupancy||0)));for(const [i,r] of rank.slice(0,12).entries()){const button=node('button',undefined,'rank');button.type='button';const label=node('span');label.append(node('b',r.name+' '+(r.direction||'')),node('small','占有率 '+fmt(r.occupancy)+'% · '+r.vd_id));button.append(node('span',String(i+1).padStart(2,'0'),'rank-num'),label,node('strong',fmt(r.speed)));button.onclick=()=>selectRoad(r);$('ranking').append(button);}if(!rank.length)$('ranking').append(node('div',valid.length?'目前篩選內無符合門檻的熱點。':'沒有足夠有效資料判讀。','empty'));
$('legend').replaceChildren();const legend=$('metric').value==='evidence'?[['red','含低速＋高占有率觀測'],['amber','含低速觀測'],['green','未達門檻'],['gray','無效／過期']]:$('metric').value==='speed'?[['red','<20 km/h'],['amber','20–40'],['green','≥40'],['gray','無效／過期']]:[['red','≥50%'],['amber','25–50%'],['green','<25%'],['gray','未知／無效']];for(const [cls,text] of legend){const item=node('span');item.append(node('i',undefined,'dot '+cls),node('span',text));$('legend').append(item);}
renderDetail(rows.find(r=>r.id===selectedId));}
function renderBus(){busLayer.clearLayers();const bus=data.current.bus,age=Date.now()-Date.parse(bus.timestamp);const stale=!Number.isFinite(age)||age>600000||age< -120000;$('stat-bus').textContent=bus.error?'—':`${bus.rows.length}${stale?'（過期）':''}`;
for(const stop of bus.rows){const popup=node('div');popup.append(node('b',stop.name),node('p','公車最新快照 · '+clock(bus.timestamp)));if(stale)popup.append(node('p','資料過期，以下不顯示有效到站倒數。'));const services=node('div',undefined,'popup-list');for(const service of stop.services){const line=node('div',undefined,'popup-line');line.append(node('span',service.route+' / '+service.direction),node('strong',stale?'過期':service.eta_seconds===null?'無預估':service.eta_seconds===0?'即將到站':Math.ceil(service.eta_seconds/60)+' 分'));services.append(line);}popup.append(services,node('small','數值為來源發布時的預估，非即時倒數。'));L.circleMarker([stop.lat,stop.lon],{radius:4,color:'#368ea0',weight:1,fillOpacity:.7}).bindPopup(popup).addTo(busLayer);}}
function renderMetro(){if(!metro)return;$('metro-period').textContent=`${metro.month} 歷史 OD · ${metro.weekdays} 個週一至週五`;$('metro-total').textContent=fmt(metro.mean_per_weekday);$('metro-bars').replaceChildren();const max=metro.top_origins[0]?.mean_per_weekday||1;for(const r of metro.top_origins.slice(0,5)){const row=node('div',undefined,'bar-row'),label=node('div',undefined,'bar-label'),track=node('div',undefined,'bar-track'),bar=node('div',undefined,'bar-fill');label.append(node('span',r.station),node('span',fmt(r.mean_per_weekday)+' 人次／日'));bar.style.width=r.mean_per_weekday/max*100+'%';track.append(bar);row.append(label,track);$('metro-bars').append(row);}
// Approximate station centers for orientation only; not entrances or walking-route geometry.
for(const [name,lat,lon] of [['西湖',25.0821,121.5672],['港墘',25.0800,121.5751]]){const p=node('div');p.append(node('b','捷運'+name+'站'),node('p',`${metro.month} · 07–10 時進站且以本站為目的地`),node('p',fmt(metro.target_means[name])+' 人次／週一至週五平均'),node('small','站中心概略位置；非出入口。未排除國定假日，非即時乘載率。'));L.marker([lat,lon],{icon:L.divIcon({className:'metro-marker',html:'M',iconSize:[25,25]}),alt:'捷運'+name}).bindPopup(p).bindTooltip('捷運'+name).addTo(metroLayer);}}
function rebuildFrames(){
 if(!data)return;const selected=selectedFrame();data.frames=combineFrames(recentFrames,[...archives.values()].flat());
 index=mode==='latest'?latestIndex():selected?data.frames.indexOf(selected):-1;
}
async function readHistoryIndex(){
 const res=await fetch('./data/history/index.json',{cache:'no-cache'});if(!res.ok)throw Error('歷史索引讀取失敗（HTTP '+res.status+'）');
 const manifest=await res.json();if(manifest.schema_version!==1||!Array.isArray(manifest.days))throw Error('歷史索引格式不符');
 historyIndex=manifest;
 const select=$('archive-day'),previous=select.value;select.replaceChildren(node('option','選擇已存入 GitHub 的日期'));select.firstChild.value='';
 for(const entry of [...manifest.days].reverse()){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(entry.day)||entry.file!==entry.day+'.json')throw Error('歷史檔名稱不符');
  const option=node('option',`${entry.day} · ${entry.frames} 筆快照 · ${(entry.bytes/1000000).toFixed(2)} MB`);option.value=entry.day;select.append(option);
 }
 if(manifest.days.some(e=>e.day===previous))select.value=previous;
 $('archive-status').textContent=manifest.days.length?`${manifest.days.length} 天歷史已存入 GitHub；選日期才下載當日檔案。`:'尚無已提交的歷史檔案。';
}
async function ensureDay(day){
 if(archives.has(day))return;
 if(archiveRequests.has(day))return archiveRequests.get(day);
 const entry=historyIndex.days.find(d=>d.day===day);if(!entry)return;
 const request=(async()=>{
  const res=await fetch('./data/history/'+entry.file);if(!res.ok)throw Error('歷史資料讀取失敗（HTTP '+res.status+'）');
  const buffer=await res.arrayBuffer();if(buffer.byteLength!==entry.bytes)throw Error('歷史檔大小與索引不符');
  const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',buffer))].map(n=>n.toString(16).padStart(2,'0')).join('');
  if(hash!==entry.sha256)throw Error('歷史檔校驗失敗，請重新整理');
  const archive=JSON.parse(new TextDecoder().decode(buffer));if(archive.day!==day)throw Error('歷史檔日期不符');
  archives.set(day,decodeArchive(archive));rebuildFrames();
 })();archiveRequests.set(day,request);
 try{await request;}finally{archiveRequests.delete(day);}
}
async function load(){
 const button=$('refresh');button.disabled=true;
 try{
  const res=await fetch('./data/dashboard.json?t='+Date.now(),{cache:'no-store'});if(!res.ok)throw Error('快照讀取失敗（HTTP '+res.status+'）');
  const next=await res.json();if(next.schema_version!==1||!next.frames?.length)throw Error('快照格式不符');
  data=next;recentFrames=next.frames;rebuildFrames();
  if(mode==='latest'){index=latestIndex();$('observation-date').value=taipeiParts(data.current.road.timestamp||data.current.captured_at).day;$('period').value='all';}
  else{const frames=chosenFrames();index=frames.length?data.frames.indexOf(frames.at(-1)):-1;}
  render();renderBus();
  try{await readHistoryIndex();await ensureDay(previousDay(today()));if(mode==='period')await ensureDay($('observation-date').value);if(mode==='period'&&index<0){const frames=chosenFrames();index=frames.length?data.frames.indexOf(frames[0]):-1;}render();}
  catch(e){$('archive-status').textContent=e.message+'；未取得歷史資料，請重試。';}
 }catch(e){$('error').hidden=false;$('error').textContent=e.message+'；請稍後重新讀取。';$('freshness').textContent='讀取失敗';}
 finally{button.disabled=false;}
}
function updateLayers(){
 const enabled=$('show-road').checked,display=$('display').value;
 for(const [layer,show] of [[heatLayer,enabled&&display!=='points'],[roadLayer,enabled&&display!=='heat']]){if(show)layer.addTo(map);else map.removeLayer(layer);}
}
function stopPlay(){clearInterval(playTimer);playTimer=null;$('play').textContent='▶ 逐筆播放';}
function latest(){stopPlay();mode='latest';if(data){index=latestIndex();$('observation-date').value=taipeiParts(frameTime(data.frames[index])).day;$('period').value='all';render();}}
async function choosePeriod(day,period){
 stopPlay();const request=++selectionRequest;mode='period';$('observation-date').value=day;$('period').value=period;
 if(!data)return;index=-1;render();
 const entry=historyIndex.days.find(d=>d.day===day);$('archive-download').hidden=!entry;
 if(entry){$('archive-download').href='./data/history/'+entry.file;$('archive-status').textContent='讀取 '+day+' 歷史觀測…';}
 try{await ensureDay(day);if(request!==selectionRequest||mode!=='period')return;
  const frames=chosenFrames();index=frames.length?data.frames.indexOf(frames[0]):-1;render();
  $('archive-status').textContent=entry?`${day} · TDX 實測快照已載入，${entry.sensors} 個方向觀測位置；非完整道路覆蓋。`:'選定日期沒有已提交的歷史檔；仍可查看已累積快照。';
 }catch(e){if(request===selectionRequest){$('archive-status').textContent=e.message+'；請重新選取日期重試。';}}
}
function stepFrame(delta){const frames=chosenFrames();if(!frames.length){stopPlay();return;}const at=frames.indexOf(selectedFrame());const next=at+delta;if(next<0||next>=frames.length){stopPlay();return;}mode='period';index=data.frames.indexOf(frames[next]);render();}
function renderComparison(){const dates=[['compare-pm',previousDay(today()),'pm','昨天下班'],['compare-am',today(),'am','今天上班']];const summaries=[];
 for(const [id,day,period,label] of dates){const summary=summarizePeriod(data.frames,day,period,currentFilters());summaries.push(summary);const root=$(id);root.replaceChildren();root.append(node('b',label+' · '+day),node('span',PERIODS[period].label),node('strong',summary.slowShare===null?'尚無觀測':Math.round(summary.slowShare*100)+'%'),node('small',summary.slowShare===null?'不能判斷塞車程度':`低速觀測平均占比 · ${summary.covered}/${summary.expected} 個時段有有效資料`));root.classList.toggle('no-data',summary.covered===0);root.onclick=()=>choosePeriod(day,period);}
 $('comparison-note').textContent=summaries.every(s=>s.coverage>=.8)?'兩時段各有至少 80% 時間格觀測；比例描述所選走廊／方向的有效感測器，不代表道路面積或延誤分鐘。上下班方向與需求不同，不直接判定政策效果。':'目前資料不足，不能比較昨天下班與今天上班誰更塞。缺資料不是 0% 塞車；至少需各時段八成時間格有有效觀測，並核對道路方向。';
}
function renderPeriodControls(){
 const availability=dataAvailability(data);$('data-status-note').textContent=availability.reason;$('schedule-status').textContent=scheduleMessage(data.collection_status);
 const frames=chosenFrames(),day=$('observation-date').value,period=$('period').value;const summary=summarizePeriod(data.frames,day,period,currentFilters());
 $('view-latest').classList.toggle('active',mode==='latest');$('today-am').classList.toggle('active',mode==='period'&&day===today()&&period==='am');$('yesterday-pm').classList.toggle('active',mode==='period'&&day===previousDay(today())&&period==='pm');
 $('selection-note').textContent=mode==='latest'?'現在只看最新發布的一次觀測；不代表早上或下班時段。':!frames.length?'此時段尚未取得觀測；無法回放，也不能說不塞。':`${PERIODS[period].label}：${summary.covered}/${summary.expected} 個 15 分鐘格有有效觀測，未觀測時段不補值。`;
 const start=new Date(day+'T00:00:00+08:00').getTime()+PERIODS[period].start*60000;if(mode==='period'&&start>Date.now())$('selection-note').textContent='這個時段還沒開始；開始後需等待排程取得觀測。';
 $('time-label').textContent=selectedFrame()?clock(frameTime(selectedFrame()))+' 實際觀測':'無可播放觀測';
 $('history-note').textContent=`${day} · ${PERIODS[period].label} · ${frames.length} 筆快照。每格只是採樣，不是連續十五分鐘量測。`;
 const timeline=$('period-timeline');timeline.replaceChildren();timeline.style.setProperty('--bins',summary.bins.length);
 for(const bin of summary.bins){const time=String(Math.floor(bin.minute/60)).padStart(2,'0')+':'+String(bin.minute%60).padStart(2,'0');const button=node('button',undefined,'time-bin');button.disabled=!bin.frames.length;button.classList.toggle('missing',bin.slowShare===null);button.classList.toggle('chosen',bin.frames.includes(selectedFrame()));
 const desc=time+' · '+(bin.slowShare===null?'無有效觀測':Math.round(bin.slowShare*100)+'% 低速觀測')+` · ${bin.frames.length} 筆快照`;button.title=desc;button.setAttribute('aria-label',desc);
 if(bin.slowShare!==null){const bar=node('span',undefined,'time-bin-fill');bar.style.height=Math.max(3,bin.slowShare*100)+'%';bar.style.background=bin.hotShare>0?'#da6250':bin.slowShare>0?'#dba33d':'#359680';button.append(bar);}button.append(node('small',time));button.onclick=()=>{stopPlay();mode='period';index=data.frames.indexOf(bin.frames[0]);render();};timeline.append(button);}
 const select=$('snapshot-select');select.replaceChildren();for(const frame of frames){const option=node('option',clock(frameTime(frame))+(frame.road.error?' · 讀取失敗':''));option.value=data.frames.indexOf(frame);select.append(option);}if(!frames.length){const empty=node('option','這個時段沒有資料');empty.value='-1';select.append(empty);}select.disabled=!frames.length;select.value=index;
 const at=frames.indexOf(selectedFrame());$('previous-frame').disabled=at<=0;$('next-frame').disabled=at<0||at>=frames.length-1;$('play').disabled=frames.length<2;
 const next=frames[at+1];$('gap-note').textContent=next&&selectedFrame()?`下一筆 ${clock(frameTime(next))}，相隔 ${Math.round((Date.parse(frameTime(next))-Date.parse(frameTime(selectedFrame())))/60000)} 分鐘。播放只切換已取得的快照，不補中間車況。`:'逐筆播放僅顯示實測快照；TDX 可回補至昨天的市區歷史，今天的完整歷史需等待隔日更新。';
 renderComparison();
}
for(const id of ['corridor','direction','metric','display'])$(id).onchange=render;$('search').oninput=render;
$('archive-day').onchange=e=>{if(e.target.value)choosePeriod(e.target.value,'am');};
$('observation-date').onchange=()=>choosePeriod($('observation-date').value,$('period').value);$('period').onchange=()=>choosePeriod($('observation-date').value,$('period').value);
$('today-am').onclick=()=>choosePeriod(today(),'am');$('yesterday-pm').onclick=()=>choosePeriod(previousDay(today()),'pm');$('view-latest').onclick=latest;$('latest').onclick=latest;
$('snapshot-select').onchange=e=>{stopPlay();mode='period';index=Number(e.target.value);render();};$('previous-frame').onclick=()=>{stopPlay();stepFrame(-1);};$('next-frame').onclick=()=>{stopPlay();stepFrame(1);};
$('play').onclick=()=>{if(playTimer){stopPlay();return;}const frames=chosenFrames();if(frames.length<2)return;mode='period';if(frames.indexOf(selectedFrame())===frames.length-1)index=data.frames.indexOf(frames[0]);$('play').textContent='Ⅱ 暫停';render();playTimer=setInterval(()=>stepFrame(1),1500);};
$('fit').onclick=()=>map.fitBounds(bounds);$('refresh').onclick=()=>{stopPlay();load();};$('show-road').onchange=updateLayers;
for(const [id,layer] of [['show-bus',busLayer],['show-metro',metroLayer]])$(id).onchange=()=>$(id).checked?layer.addTo(map):map.removeLayer(layer);
fetch('./data/metro.json').then(r=>{if(!r.ok)throw Error('捷運歷史資料讀取失敗');return r.json();}).then(d=>{metro=d;renderMetro();}).catch(e=>$('metro-period').textContent=e.message);
new ResizeObserver(()=>map.invalidateSize()).observe($('map'));
load().then(()=>{const view=new URLSearchParams(location.search).get('view');if(view==='today-am')return choosePeriod(today(),'am');if(view==='yesterday-pm')return choosePeriod(previousDay(today()),'pm');});setInterval(()=>{if(!document.hidden&&data){render();renderBus();}},60000);

setInterval(()=>{if(!document.hidden&&!historical())load();},300000);
