import {defaults,experiment,runScenario,modelVersion} from './simulation_logic.js';
import {projectInputs,profileWeights} from './growth_logic.js';
import {initGrowth,readGrowth,renderGrowth,clearGrowth} from './growth.js';
const $=id=>document.getElementById(id);
const node=(tag,text)=>{const e=document.createElement(tag);e.textContent=text;return e;};
const fmt=(value,digits=0)=>value.toLocaleString('zh-TW',{maximumFractionDigits:digits});
const fields=[
 ['people','基期原搭私車人次（假設）',0,100000,100,'basic'],
 ['occupancy','私車平均乘員（人）',1,10,.1,'basic'],
 ['peakMinutes','基期尖峰長度（分）',30,240,15,'basic'],
 ['innerShare','原走主要通道（%）',0,100,5,'basic',100],
 ['innerCapacity','主要通過能力（PCU／時）',50,15000,50,'basic'],
 ['outerCapacity','外圍通過能力（PCU／時）',50,15000,50,'basic'],
 ['busShare','改搭巴士（%）',0,100,5,'policy',100],
 ['staggerShare','剩餘私車延後出發（%）',0,100,5,'policy',100],
 ['shiftMinutes','延後多久（分）',0,120,15,'policy'],
 ['restrictShare','主要通道私車改道（%）',0,100,5,'policy',100],
 ['freeMinutes','主要通道自由行駛（分）',1,120,1,'advanced'],
 ['detourMinutes','外圍額外行駛（分）',0,120,1,'advanced'],
 ['busSeats','巴士額定容量（人）',1,200,1,'advanced'],
 ['busLoad','巴士規劃載客率（%）',1,100,1,'advanced',100],
 ['busPCU','每輛巴士道路占用（PCU）',1,5,.1,'advanced'],
 ['cycleMinutes','固定巴士循環（分）',1,480,1,'advanced'],
 ['reserve','巴士備車（%）',0,100,5,'advanced',100]];
for(const [id,label,min,max,step,group,scale=1] of fields){
 const el=node('label',label),input=document.createElement('input');
 Object.assign(input,{type:'number',id:'sim-'+id,min,max,step,value:defaults[id]*scale,required:true});
 el.append(input);$(group+'-inputs').append(el);
}
let inputs={...defaults},baseInputs={...defaults},growthSettings,growthReport,clockOffset=360,results=[],selected='restrict',sensitivity=[],timer;
const clock=minute=>{const total=clockOffset+minute;return `${String(Math.floor(total/60)%24).padStart(2,'0')}:${String(total%60).padStart(2,'0')}${total>=1440?'（次日）':''}`;};
const current=()=>results.find(r=>r.id===selected)||results[0];
function change(value,base){return base>1e-8?`${value>base?'+':''}${fmt((value/base-1)*100,1)}%`:`參考為 0；${fmt(value,1)}`;}
function bounded(value,r){return (r.residualPCU>1e-7?'≥':'')+fmt(value,1);}
function renderTable(){
 $('simulation-results').replaceChildren();
 for(const r of results){
  const row=node('tr','');if(r.id===selected)row.className='sim-selected';
  for(const value of [r.label,fmt(r.carTrips),fmt(r.busDepartures),fmt(r.totalFleet),fmt(r.maxInnerQueue)+' PCU',fmt(r.maxOuterQueue)+' PCU',bounded(r.queuePCUHours,r),bounded(r.totalPCUHours,r)])row.append(node('td',value));
  $('simulation-results').append(row);
 }
 $('simulation-summary').textContent=`基期後 ${growthSettings.years} 年 · 同一批 ${fmt(inputs.people)} 假設人次 · ${inputs.demandWeights?'實測相對型態':'人工需求曲線'} ${clock(60)}–${clock(60+inputs.peakMinutes)}。所有情境保留總人次；參考情境未經現況校正。`;
}
function renderChart(){
 const r=current(),base=results[0],duration=Math.max(r.series.length,base.series.length);
 const peak=Math.max(1,...r.series.map(v=>Math.max(v.innerQueue,v.outerQueue)),...base.series.map(v=>v.innerQueue+v.outerQueue));
 const top=Math.ceil(peak/100)*100,x=t=>60+t/duration*740,y=v=>260-v/top*220;
 const line=(rows,get)=>'M '+rows.map(v=>`${x(v.minute).toFixed(2)},${y(get(v)).toFixed(2)}`).join(' L ');
 const ticks=Array.from({length:5},(_,i)=>{const v=top*i/4;return `<line x1="60" x2="800" y1="${y(v)}" y2="${y(v)}" stroke="#dce5e1"/><text x="50" y="${y(v)+4}" text-anchor="end">${Math.round(v)}</text>`;}).join('');
 const times=Array.from({length:7},(_,i)=>{const t=Math.round(duration*i/6);return `<text x="${x(t)}" y="285" text-anchor="middle">${clock(t)}</text>`;}).join('');
 $('simulation-chart').innerHTML=`<svg viewBox="0 0 840 310" role="img" aria-label="假設模型排隊曲線，灰色參考總排隊、橘色主要通道、藍色外圍"><g fill="#4b6560" font-size="12"><text x="60" y="20">排隊 PCU · 假設模型</text>${ticks}${times}</g><path d="${line(base.series,v=>v.innerQueue+v.outerQueue)}" stroke="#7d8987" stroke-width="2" stroke-dasharray="6 4" fill="none"/><path d="${line(r.series,v=>v.innerQueue)}" stroke="#bd6a25" stroke-width="3" fill="none"/><path d="${line(r.series,v=>v.outerQueue)}" stroke="#247da8" stroke-width="3" fill="none"/><line id="sim-cursor" y1="35" y2="260" stroke="#314f49" stroke-dasharray="3 3"/></svg>`;
 $('simulation-minute').max=duration;$('simulation-minute').value=Math.min(Number($('simulation-minute').value),duration);
 replay();
}
function replay(){
 if(!results.length)return;
 const r=current(),minute=Number($('simulation-minute').value),row=r.series[minute-1]||{innerQueue:0,outerQueue:0,innerArrivals:0,outerArrivals:0};
 $('simulation-clock').textContent=clock(minute);
 const cursor=$('sim-cursor'),x=60+minute/Number($('simulation-minute').max)*740;
 cursor?.setAttribute('x1',x);cursor?.setAttribute('x2',x);
 for(const [id,key,capacity] of [['inner','innerQueue',inputs.innerCapacity],['outer','outerQueue',inputs.outerCapacity]]){
  const q=row[key],box=$('channel-'+id),ratio=q/capacity;
  box.style.background=ratio>.25?'#f7d3bf':ratio>.05?'#ffe5b6':q>1e-7?'#f6edcf':'#e4f1e6';
  box.querySelector('strong').textContent=fmt(q,1)+' PCU 排隊';
  box.querySelector('small').textContent=`這分鐘進入 ${fmt(row[id+'Arrivals'],1)} PCU · 假設可通過 ${fmt(capacity/60,1)} PCU／分`;
 }
}
function renderComparison(){
 const r=current(),base=results[0];
 let message=`${r.label}：主要最高排隊 ${fmt(r.maxInnerQueue)}、外圍 ${fmt(r.maxOuterQueue)} PCU。`;
 if(r.residualPCU>1e-7||base.residualPCU>1e-7)message+=`模擬截止仍有未排空需求（本情境 ${fmt(r.residualPCU)} PCU）；時間總量為下限，不能據此比較改善幅度。`;
 else message+=`排隊總量較參考 ${change(r.queuePCUHours,base.queuePCUHours)}；加上假設自由行駛與繞路後，PCU 時間總量 ${change(r.totalPCUHours,base.totalPCUHours)}。`;
 if(r.divertedCars>0)message+=` ${fmt(r.divertedCars)} 私車旅次移往外圍，額外繞路 ${fmt(r.addedDetourCarHours,1)} 車·時。`;
 if(r.busPassengers>0)message+=` ${fmt(r.busPassengers)} 人改搭巴士，${r.busDepartures} 班、尖峰連續一小時最多 ${r.busiestHourDepartures} 班；${r.operatingFleet} 輛營運＋${r.reserveFleet} 輛備車。`;
 message+=' 結果只在這組假設內成立；巴士等車、乘客旅行時間與營運成本尚未比較。';
 $('simulation-diagnosis').textContent=message;
 sensitivity=[.8,1,1.2].map(scale=>{
  const a={...inputs,innerCapacity:inputs.innerCapacity*scale,outerCapacity:inputs.outerCapacity*scale};
  // Avoid silently clamping user inputs at the supported model boundary.
  try{return {scale,baseline:runScenario(a),selected:runScenario(a,r.policy)};}catch{return {scale,error:'超出容量支援範圍'};}
 });
 $('simulation-sensitivity').replaceChildren();
 for(const s of sensitivity){
  const tr=node('tr',''),values=s.error?[fmt(s.scale*100)+'%',s.error,'—','—','—']:
   [fmt(s.scale*100)+'%',bounded(s.baseline.queuePCUHours,s.baseline),bounded(s.selected.queuePCUHours,s.selected),fmt(s.selected.maxOuterQueue),
    s.baseline.residualPCU+s.selected.residualPCU>1e-7?'未排空，暫不比較':change(s.selected.totalPCUHours,s.baseline.totalPCUHours)];
  for(const value of values)tr.append(node('td',value));$('simulation-sensitivity').append(tr);
 }
 growthReport=renderGrowth(baseInputs,growthSettings,r.policy);
}
function render(){renderTable();renderChart();renderComparison();}
function run(){
 clearTimeout(timer);
 try{
  const settings=readGrowth();
  if(settings.profile)$('sim-peakMinutes').value=150;
  const next={};
  for(const [id,,,,,,scale=1] of fields){const el=$('sim-'+id);if(!el.value||!el.checkValidity())throw Error('請填入所有欄位允許範圍內的數字。');next[id]=Number(el.value)/scale;}
  if(settings.profile){next.demandWeights=profileWeights(settings.profile);next.demandSource={id:settings.profile.id,days:settings.profile.days,start_minute:settings.profile.start_minute,kind:'observed_sample_shape_not_total_demand'};}
  const projected=projectInputs(next,settings),nextResults=experiment(projected);
  baseInputs=next;growthSettings=settings;inputs=projected;results=nextResults;clockOffset=settings.profile?settings.profile.start_minute-60:360;
  $('simulation-error').hidden=true;$('download-simulation').disabled=false;$('simulation-choice').disabled=false;$('simulation-minute').disabled=false;
  render();
 }catch(e){
  results=[];growthReport=null;clearGrowth();$('simulation-error').hidden=false;$('simulation-error').textContent=e.message;
  for(const id of ['simulation-results','simulation-chart','simulation-sensitivity'])$(id).replaceChildren();
  $('simulation-summary').textContent='輸入無效；已清除上一組結果。';$('simulation-diagnosis').textContent='修正輸入後重新計算。';
  for(const id of ['inner','outer']){$('channel-'+id).style.background='#eef1ef';$('channel-'+id).querySelector('strong').textContent='—';$('channel-'+id).querySelector('small').textContent='沒有有效結果';}
  $('download-simulation').disabled=true;$('simulation-choice').disabled=true;$('simulation-minute').disabled=true;
 }
}
for(const r of experiment(defaults)){const option=node('option',r.label);option.value=r.id;$('simulation-choice').append(option);}
$('simulation-choice').value=selected;
$('simulation-choice').onchange=()=>{selected=$('simulation-choice').value;render();};
$('simulation-minute').oninput=replay;
$('simulation-form').onsubmit=e=>e.preventDefault();
$('simulation-form').oninput=()=>{clearTimeout(timer);timer=setTimeout(run,150);};
$('reset-simulation').onclick=()=>{for(const [id,,,,,,scale=1] of fields)$('sim-'+id).value=defaults[id]*scale;$('growth-mode').value='synthetic';$('growth-years').value=0;$('growth-rate').value=2;$('growth-capacity').value=0;$('growth-metro-rate').value=2;run();};
$('download-simulation').onclick=()=>{
 const report={schema_version:2,model_version:modelVersion,calibrated:false,input_type:inputs.demandWeights?'observed_shape_with_assumed_magnitude_and_growth':'assumptions_not_measured_demand',generated_at:new Date().toISOString(),
  base_inputs:baseInputs,growth:growthReport,inputs,selected,units:{queue:'PCU',time_total:'PCU hours',timeline:`minutes after ${clock(0)}`},
  limitations:['Two abstract point queues; no spillback, signals, or route choice equilibrium','No transit person-time, operating cost, weather calibration or metro spare capacity','Fixed bus cycles; no return-direction traffic or driver scheduling'],results,sensitivity};
 const url=URL.createObjectURL(new Blob([JSON.stringify(report)],{type:'application/json'})),a=node('a','');a.href=url;a.download='neihu-assumption-simulation.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
run();
initGrowth(run);
(async()=>{
 try{
  const response=await fetch('./data/weeks/index.json',{cache:'no-cache'});if(!response.ok)throw Error('週索引讀取失敗');
  const index=await response.json(),entry=[...index.weeks].reverse().find(w=>w.available_days>0);
  if(!entry||!/^\d{4}-\d{2}-\d{2}\.json$/.test(entry.file))throw Error('尚無可用週摘要');
  const responseWeek=await fetch('./data/weeks/'+entry.file,{cache:'no-cache'});if(!responseWeek.ok)throw Error('週摘要讀取失敗');
  const bytes=await responseWeek.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(bytes.byteLength!==entry.bytes||hash!==entry.sha256)throw Error('週摘要版本不符');
  const week=JSON.parse(new TextDecoder().decode(bytes)),hot=week.hotspot_candidates.am.slice(0,3);
  $('evidence').textContent=`實測歷史到 ${index.latest_available_day||index.as_of}；${week.start} 起這週的晨尖峰待查候選：${hot.length?hot.map(h=>h.road+' '+(h.direction||'')).join('、'):'有效日期不足'}。這些位置尚未用來校正下方假設通道，不能把模擬結果直接套在這些街道。`;
 }catch(e){$('evidence').textContent=`${e.message}；實測參考暫不可用，下方仍可執行假設實驗。`;}
})();
