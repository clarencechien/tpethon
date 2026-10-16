// Reusable, responsive comparisons. Text is the accessible chart; color is supplementary.
export const element=(tag,text='')=>{const e=document.createElement(tag);e.textContent=text;return e;};
export const number=(v,d=1)=>Number.isFinite(v)?v.toLocaleString('zh-TW',{maximumFractionDigits:d}):'未知';
export function bars(target,series,{unit='',max=null}={}){
 target.replaceChildren();const scale=max??Math.max(1,...series.map(s=>s.value).filter(Number.isFinite));
 for(const [i,s]of series.entries()){
  const row=element('div');row.className='metric-row';const label=element('div');label.className='metric-label';
  label.append(element('span',s.label),element('strong',Number.isFinite(s.value)?`${s.lowerBound?'≥ ':''}${s.value>0&&s.value<.05?'< 0.1':number(s.value)}${unit}`:'未知'));
  const track=element('div');track.className='metric-track';track.setAttribute('aria-hidden','true');
  const fill=element('div');fill.className='metric-fill '+(s.kind??(i===0?'base':''));fill.style.width=`${Number.isFinite(s.value)?Math.max(0,Math.min(100,s.value/scale*100)):0}%`;track.append(fill);row.append(label,track);target.append(row);
 }
}
export function resultCards(target,comparisons){
 target.replaceChildren();for(const c of comparisons){const card=element('article');card.className='result-card';card.append(element('h3',c.title));if(c.note){const note=element('p',c.note);note.className='fine';card.append(note);}const chart=element('div');bars(chart,c.series,{unit:c.unit});card.append(chart);target.append(card);}
}
