import {networkExample} from './network_logic.js';
import {bars,number,element} from './ui.js';
const $=id=>document.getElementById(id),names={forward:'A → B 開放',closed:'封閉中間連接道',reverse:'改為 B → A 單行'};
function render(){
 const q=Number($('network-demand').value),mode=$('network-mode').value;
 const results=['forward','closed','reverse'].map(m=>networkExample(q,m)),r=results.find(v=>v.mode===mode),base=results[0];
 $('network-count').textContent=number(q,0)+' 輛／小時';
 bars($('network-comparison'),results.map(v=>({label:names[v.mode],value:v.minutes,kind:v.mode===mode?'':'before'})),{unit:' 分鐘'});
 $('network-verdict').textContent=`這個假想路網中，${names[mode]}後，每車平均 ${number(r.minutes)} 分鐘。${mode==='forward'?'這是本次比較的原狀。':Math.abs(r.minutes-base.minutes)<1e-7?'與原狀相同。':`比原狀${r.minutes<base.minutes?'少':'多'} ${number(Math.abs(r.minutes-base.minutes))} 分鐘。`}不是內湖的預測。`;
 for(const id of ['sa','sb','at','bt'])$('flow-'+id).textContent=number(r.edges[id],0)+' 輛／時';
 $('connector-label').textContent=mode==='closed'?'封閉':mode==='forward'?'A → B':'B → A';
 $('connector-path').setAttribute('d',mode==='reverse'?'M 250 290 L 250 125':'M 250 125 L 250 290');
 $('connector-path').setAttribute('marker-end',mode==='closed'?'none':'url(#arrow)');
 $('connector-path').setAttribute('stroke-dasharray',mode==='closed'?'7 7':'none');
 $('flow-connector').textContent=number(r.edges.connector,0)+' 輛／時';
 $('network-routes').replaceChildren();
 for(const [key,label]of [['upper','起點 → A → 終點'],['lower','起點 → B → 終點'],['connector',mode==='reverse'?'起點 → B → A → 終點':'起點 → A → B → 終點']]){
  const item=element('li',`${label}：${number(r.paths[key],0)} 輛／小時${key==='connector'&&mode==='closed'?'（此路徑已封閉）':`；此刻走這條路需 ${number(r.costs[key])} 分鐘`}`);$('network-routes').append(item);
 }
 $('network-conservation').textContent=`三條可選路徑合計 ${number(Object.values(r.paths).reduce((a,b)=>a+b,0),0)} 輛／小時，與原始需求相同。封路沒有刪掉任何旅次；改變的是大家選哪條路。`;
}
$('network-demand').oninput=render;$('network-mode').onchange=render;
for(const button of document.querySelectorAll('[data-demand]'))button.onclick=()=>{$('network-demand').value=button.dataset.demand;render();};render();
