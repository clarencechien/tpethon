import {number} from './ui.js';
const $=id=>document.getElementById(id),n=(v,d=0)=>number(v,d);
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const candidates=[['花博／圓山','圓山'],['松山機場','松山機場'],['松山車站','松山'],['南港車站','南港'],['市政府','市政府'],['台北車站','台北車站'],['板橋車站','BL板橋、Y板橋'],['延伸比較：南港展覽館','南港展覽館']];
function bars(rows,max){return rows.map(r=>`<div class="metric-row"><div class="metric-label"><span>${esc(r.label)}</span><strong>${n(r.value,1)} 人次</strong></div><div class="metric-track" aria-hidden="true"><div class="metric-fill" style="width:${max?r.value/max*100:0}%"></div></div></div>`).join('');}
try{
 const response=await fetch('data/simulation/hub-metro.json');if(!response.ok)throw Error(`HTTP ${response.status}`);
 const data=await response.json();
 $('hub-metro-date').innerHTML='<option value="all">全部週一至週五平均（含假日）</option>'+data.dates.map((d,i)=>`<option value="${i}">${esc(d)}</option>`).join('');
 const draw=()=>{
  const selection=$('hub-metro-date').value,indices=selection==='all'?data.dates.map((_,i)=>i):[Number(selection)],days=indices.length;
  const rows=data.origins.map(o=>({station:o.station,total:indices.reduce((sum,i)=>sum+o.daily_hourly[i].reduce((a,b)=>a+b,0),0)})).sort((a,b)=>b.total-a.total||a.station.localeCompare(b.station));
  const total=rows.reduce((sum,r)=>sum+r.total,0),candidateStations=new Set(candidates.flatMap(c=>c[1].split('、')));
  const subset=rows.filter(r=>candidateStations.has(r.station)).reduce((sum,r)=>sum+r.total,0);
  $('hub-metro-summary').textContent=`${selection==='all'?data.month+'，'+days+'個週一至週五日的平均':data.dates[indices[0]]}：07–10時進站、目的地為西湖或港墘，共 ${n(total/days,1)} 人次${selection==='all'?'／日':''}。下列8個候選對應進站站點合計占 ${n(total?subset/total*100:0,1)}%；這是既有捷運旅次，不是可減少的汽車。`;
  $('hub-metro-origins').innerHTML=bars(rows.slice(0,12).map(r=>({label:r.station,value:r.total/days})),(rows[0]?.total||0)/days);
  const hourly=data.entry_hours.map((h,k)=>({label:`${String(h).padStart(2,'0')}:00–${String(h+1).padStart(2,'0')}:00 進站`,value:data.origins.reduce((s,o)=>s+indices.reduce((v,i)=>v+o.daily_hourly[i][k],0),0)/days}));
  $('hub-metro-hours').innerHTML=bars(hourly,Math.max(...hourly.map(r=>r.value),1));
  $('hub-metro-candidates').querySelector('tbody').innerHTML=candidates.map(([name,station])=>{const matched=rows.filter(r=>station.split('、').includes(r.station)),row=matched.length?{total:matched.reduce((s,r)=>s+r.total,0)}:null;return `<tr><th>${esc(name)}</th><td>${esc(station)}</td><td>${row?n(row.total/days,1):'未見來源站紀錄'}</td><td>${row&&total?n(row.total/total*100,1)+'%':'—'}</td></tr>`;}).join('');
 };
 $('hub-metro-date').onchange=draw;draw();$('hub-metro-observations').hidden=false;$('hub-metro-status').textContent='已載入官方捷運OD彙整；以下圖表與合成模擬分開。';
}catch(e){$('hub-metro-observations').hidden=true;$('hub-metro-status').textContent='捷運來源資料暫時無法讀取，不能顯示為零人次。其他合成實驗仍可使用。';}
