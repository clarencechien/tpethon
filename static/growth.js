import {annualProjection,compound,metroBaseline,profileWeights} from './growth_logic.js';
const $=id=>document.getElementById(id),fmt=(v,d=0)=>v.toLocaleString('zh-TW',{maximumFractionDigits:d});
const element=(tag,text)=>{const el=document.createElement(tag);el.textContent=text;return el;};
let profiles=[],profileDescriptor=null,profileError='實測型態載入中',metro=null,metroError='捷運基準載入中';
const time=m=>`${String(Math.floor(m/60)).padStart(2,'0')}:${String(m%60).padStart(2,'0')}`;
const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function chart(id,labels,lines,unit){
 const max=Math.max(1,...lines.flatMap(line=>line.values.filter(Number.isFinite)))*1.12;
 const x=i=>65+i/Math.max(1,labels.length-1)*555,y=v=>215-v/max*175;
 const grid=Array.from({length:4},(_,i)=>{const value=max*i/3;return `<line x1="65" x2="620" y1="${y(value)}" y2="${y(value)}" stroke="#dce5e1"/><text x="57" y="${y(value)+4}" text-anchor="end">${fmt(value)}</text>`;}).join('');
 const ticks=labels.map((label,i)=>labels.length>11&&i%2&&i!==labels.length-1?'':`<text x="${x(i)}" y="239" text-anchor="middle">${escape(label)}</text>`).join('');
 const paths=lines.map(line=>{
  let pen=false;const path=line.values.map((value,i)=>{if(!Number.isFinite(value)){pen=false;return '';}const cmd=pen?'L':'M';pen=true;return `${cmd}${x(i)},${y(value)}`;}).join(' ');
  return `<path d="${path}" fill="none" stroke="${line.color}" stroke-width="2.5"/>`+line.values.map((value,i)=>Number.isFinite(value)?`<circle cx="${x(i)}" cy="${y(value)}" r="3" fill="${line.color}"><title>${escape(labels[i])} · ${escape(line.name)}：${fmt(value,2)}</title></circle>`:'').join('');
 }).join('');
 $(id).innerHTML=`<svg viewBox="0 0 660 285" role="img" aria-label="${escape(unit)}"><g fill="#4b6560" font-size="16"><text x="65" y="20">${escape(unit)}</text>${grid}${ticks}</g>${paths}<g font-size="16">${lines.map((line,i)=>`<text x="${65+i*270}" y="271" fill="${line.color}">${escape(line.name)}</text>`).join('')}</g></svg>`;
}

function fillProfiles(){
 const select=$('growth-profile'),old=select.value;select.replaceChildren();
 const candidates=profiles.filter(p=>p.period===$('growth-period').value).sort((a,b)=>(a.name+' '+a.direction+' '+a.id).localeCompare(b.name+' '+b.direction+' '+b.id,'zh-TW'));
 for(const p of candidates){const option=element('option',`${p.name} ${p.direction||''} · ${p.sensor_id} · ${p.days.length}天`);option.value=p.id;select.append(option);}
 const preferred=candidates.find(p=>p.id===old)||candidates.find(p=>p.name==='堤頂大道'&&p.direction==='N')||candidates[0];
 if(preferred)select.value=preferred.id;
 else select.append(element('option',profileError||'無完整型態'));
}

export function readGrowth(){
 const read=id=>{const input=$(id);if(input.value===''||!input.checkValidity())throw Error('請填入有效的年成長率與整數年數');return Number(input.value);};
 const settings={demandRate:read('growth-rate')/100,capacityRate:read('growth-capacity')/100,years:read('growth-years'),metroRate:read('growth-metro-rate')/100};
 compound(1,settings.demandRate,settings.years);compound(1,settings.capacityRate,settings.years);compound(1,settings.metroRate,settings.years);
 const observed=$('growth-mode').value==='observed';
 const profile=observed?profiles.find(p=>p.id===$('growth-profile').value):null;
 if(observed&&!profile)throw Error(profileError||'沒有足夠完整的實測型態，請選人工示例或稍後重試');
 if(profile)profileWeights(profile);
 $('sim-peakMinutes').readOnly=observed;
 return {...settings,profile};
}

export function renderGrowth(base,settings,policy){
 const annual=annualProjection(base,settings,policy),profile=settings.profile;
 if(profile){
  const growth=compound(1,settings.demandRate,settings.years);
  $('growth-source').textContent=`已套用 ${profile.name} ${profile.direction||''} · ${profile.sensor_id}；${profile.days[0]}–${profile.days.at(-1)}，${profile.days.length} 個完整參考工作日，${time(profile.start_minute)}–${time(profile.start_minute+150)}。同一組日期的 10 個抽樣點取等權平均；假日依社群日曆排除，非企業出勤紀錄。`;
  chart('growth-volume-chart',profile.values.map((_,i)=>time(profile.start_minute+i*15)),[
   {name:'實測抽樣平均',values:profile.values,color:'#24745d'},
   {name:`${settings.years} 年後情境`,values:profile.values.map(v=>v*growth),color:'#ba6b25'}], '原始 Volume／來源統計區間（區間長度未確認）');
  $('growth-volume-note').textContent='點為實測抽樣平均或其成長情境；連線只是視覺輔助。不能把這十點相加成尖峰總車流，也不能由此判斷道路容量。';
 }else{
  $('growth-source').textContent='目前使用人工單峰示例。可改選單一 VD 實測相對型態；總人次和容量仍需另外提供。';
  $('growth-volume-chart').replaceChildren();$('growth-volume-note').textContent='';
 }
 const metroMean=metro?metroBaseline(metro):null;
 const metroValues=annual.map(row=>metroMean===null?null:compound(metroMean,settings.metroRate,row.years));
 chart('growth-demand-chart',annual.map(row=>String(row.years)),[
  {name:'假設私車人次',values:annual.map(row=>row.people),color:'#24745d'},
  {name:'捷運獨立推估',values:metroValues,color:'#8860ad'}], '人次／對應時段 · X 軸為基期後年數');
 chart('growth-queue-chart',annual.map(row=>String(row.years)),[
  {name:'每年無政策',values:annual.map(row=>row.baseline.residualPCU>1e-7?null:row.baseline.queuePCUHours),color:'#7d8987'},
  {name:'每年所選政策',values:annual.map(row=>row.selected.residualPCU>1e-7?null:row.selected.queuePCUHours),color:'#bd6a25'}], '排隊 PCU·時（未排空處不連線）');
 $('growth-metro-source').textContent=metro?`捷運實測基期：${metro.dates[0]}–${metro.dates.at(-1)}，${metro.weekdays} 個週一至週五、未排國定假日；07–10 時進站且目的地為西湖／港墘，平均 ${fmt(metroMean,2)} 人次。不是到站時間、開車族或列車剩餘容量；不加入道路模型。`:`${metroError}；不以零人次替代。`;
 $('growth-years-table').replaceChildren();
 for(const [i,row] of annual.entries()){
  const tr=element('tr','');for(const value of [row.years,fmt(row.people),fmt(row.innerCapacity),
   (row.baseline.residualPCU>1e-7?'≥':'')+fmt(row.baseline.queuePCUHours,1),(row.selected.residualPCU>1e-7?'≥':'')+fmt(row.selected.queuePCUHours,1),
   row.selected.totalFleet,metroValues[i]===null?'—':fmt(metroValues[i],1)])tr.append(element('td',value));$('growth-years-table').append(tr);
 }
 const final=annual.at(-1);
 $('growth-applied').textContent=`下方六情境與排隊回放已使用「${settings.years} 年後」：基期 ${fmt(base.people)} → ${fmt(final.people)} 假設人次；主要容量 ${fmt(base.innerCapacity)} → ${fmt(final.innerCapacity)} PCU／時。實測型態不等於實測總需求；成長率不是從這兩週估計。`;
 return {settings:{demandRate:settings.demandRate,capacityRate:settings.capacityRate,years:settings.years,metroRate:settings.metroRate},
  profile:profile?{...profile,descriptor:profileDescriptor}:null,annual,
  metro:metro?{source:metro.source,dates:metro.dates,weekdays:metro.weekdays,time_note:metro.time_note,calendar_note:metro.calendar_note,base_mean:metroMean,projected_means:metroValues}:null};
}

export function clearGrowth(){
 for(const id of ['growth-years-table','growth-demand-chart','growth-queue-chart','growth-volume-chart'])$(id).replaceChildren();
 $('growth-applied').textContent='輸入或實測型態尚不可用，未套用未來推估。';
 $('growth-source').textContent=profileError||'請修正輸入；實測資料不會改成零。';
 $('growth-volume-note').textContent='';
}

export async function initGrowth(onChange){
 $('growth-form').onsubmit=e=>e.preventDefault();
 $('growth-form').oninput=event=>{if(event.target.id==='growth-period')fillProfiles();onChange();};
 async function loadProfiles(){
  const response=await fetch('./data/weeks/index.json',{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('週索引讀取失敗');
  const index=await response.json(),entry=index.demand_profiles;
  if(entry?.file!=='profiles.json')throw Error('目前週摘要尚未附實測需求型態');
  const r=await fetch('./data/weeks/profiles.json',{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!r.ok)throw Error('實測型態讀取失敗');
  const raw=await r.arrayBuffer(),hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',raw))].map(v=>v.toString(16).padStart(2,'0')).join('');
  if(raw.byteLength!==entry.bytes||hash!==entry.sha256)throw Error('實測型態與週索引版本不一致，請重新整理');
  const data=JSON.parse(new TextDecoder().decode(raw));
  if(data.as_of!==index.as_of||data.kind!=='single_direction_sampled_volume_shape'||!Array.isArray(data.profiles))throw Error('實測型態格式或日期不符');
  for(const profile of data.profiles)profileWeights(profile);
  profiles=data.profiles;profileDescriptor={...entry,as_of:data.as_of};profileError='';fillProfiles();
 }
 async function loadMetro(){
  const response=await fetch('./data/metro.json',{cache:'no-cache',signal:AbortSignal.timeout(20000)});if(!response.ok)throw Error('捷運基準讀取失敗');
  const data=await response.json();metroBaseline(data);metro=data;metroError='';
 }
 const outcomes=await Promise.allSettled([loadProfiles(),loadMetro()]);
 if(outcomes[0].status==='rejected'){profileError=outcomes[0].reason.message;fillProfiles();}
 if(outcomes[1].status==='rejected'){metroError=outcomes[1].reason.message;$('growth-metro-source').textContent=metroError;}
 onChange();
}
