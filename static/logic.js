// Shared, dependency-free interpretation rules; tested separately from the map.
export function classify(row, reference = Date.now()) {
  const stamp=Date.parse(row.timestamp);
  if (!Number.isFinite(stamp) || reference-stamp>600000 || stamp-reference>120000) return 'stale';
  if (row.status!=='0' || !Number.isFinite(row.speed) || !row.active_lanes) return 'invalid';
  if (row.speed<20 && Number.isFinite(row.occupancy) && row.occupancy>=25) return 'hot';
  if (row.speed<20) return 'slow';
  return 'normal';
}
export function filtered(rows, corridor='', direction='', search='') {
  const q=search.trim().toLowerCase();
  return rows.filter(r=>(!corridor||r.name.includes(corridor))&&(!direction||r.direction===direction)&&(!q||(r.name+' '+r.vd_id+' '+r.link_id).toLowerCase().includes(q)));
}
export function repeatedEvidence(id, frames, index) {
  const selected=frames[index];
  if (!selected) return {hot:0,total:0};
  const end=Date.parse(selected.captured_at),seen=new Set();let hot=0,total=0;
  for(const f of frames.slice(0,index+1)) {
    const time=Date.parse(f.captured_at);
    if (end-time>3600000) continue;
    const row=f.road.rows.find(r=>r.id===id);
    if (!row||seen.has(row.timestamp)) continue;
    seen.add(row.timestamp);
    const state=classify(row,time);
    if(['hot','slow','normal'].includes(state)){total++;if(state==='hot')hot++;}
  }
  return {hot,total};
}
export function color(row, metric, reference) {
  const state=classify(row,reference);
  if(['stale','invalid'].includes(state))return '#9ba8a0';
  if(metric==='speed')return row.speed<20?'#da6250':row.speed<40?'#dba33d':'#359680';
  if(metric==='occupancy')return !Number.isFinite(row.occupancy)?'#9ba8a0':row.occupancy>=50?'#da6250':row.occupancy>=25?'#dba33d':'#359680';
  return {hot:'#da6250',slow:'#dba33d',normal:'#359680'}[state];
}

export const PERIODS={am:{label:'上班 07:00–09:30',start:420,end:570},pm:{label:'下班 17:00–19:30',start:1020,end:1170},off:{label:'離峰 10:00–16:00',start:600,end:960},all:{label:'全日 00:00–24:00',start:0,end:1440}};
export function taipeiParts(timestamp){
  const ms=Date.parse(timestamp);
  if(!Number.isFinite(ms))return null;
  const d=new Date(ms+8*3600000);
  return {day:d.toISOString().slice(0,10),minute:d.getUTCHours()*60+d.getUTCMinutes()};
}
export function previousDay(day){return new Date(Date.parse(day+'T00:00:00Z')-86400000).toISOString().slice(0,10);}
export function frameTime(frame){return frame.road.timestamp||frame.captured_at;}
export function periodFrames(frames,day,period){
  const p=PERIODS[period];return frames.filter(f=>{const t=taipeiParts(frameTime(f));return t&&t.day===day&&t.minute>=p.start&&t.minute<p.end;});
}
export function snapshotStats(rows,reference){
  const valid=rows.filter(r=>['hot','slow','normal'].includes(classify(r,reference)));
  return {valid:valid.length,total:rows.length,hot:valid.filter(r=>classify(r,reference)==='hot').length,slow:valid.filter(r=>r.speed<20).length};
}
export function summarizePeriod(frames,day,period,filters={}){
  const p=PERIODS[period],selected=periodFrames(frames,day,period);
  const bins=Array.from({length:(p.end-p.start)/15},(_,i)=>({minute:p.start+i*15,frames:[],validSnapshots:0,slowShare:null,hotShare:null}));
  for(const f of selected){const t=taipeiParts(frameTime(f));bins[Math.floor((t.minute-p.start)/15)].frames.push(f);}
  for(const b of bins){const stats=b.frames.map(f=>snapshotStats(filtered(f.road.rows,filters.corridor,filters.direction,filters.search),Date.parse(f.captured_at))).filter(s=>s.valid>0);b.validSnapshots=stats.length;if(stats.length){b.slowShare=stats.reduce((n,s)=>n+s.slow/s.valid,0)/stats.length;b.hotShare=stats.reduce((n,s)=>n+s.hot/s.valid,0)/stats.length;}}
  const available=bins.filter(b=>b.slowShare!==null);
  return {frames:selected,bins,covered:available.length,expected:bins.length,coverage:available.length/bins.length,
    slowShare:available.length?available.reduce((n,b)=>n+b.slowShare,0)/available.length:null,
    hotShare:available.length?available.reduce((n,b)=>n+b.hotShare,0)/available.length:null};
}
// 400 m fixed geographic grid, not a kernel that makes denser sensors look more congested.
export function heatCells(rows,reference,metric='evidence'){
  const cells=new Map();const dy=400/111320,dx=400/(111320*Math.cos(25.075*Math.PI/180));
  for(const r of rows){if(!['hot','slow','normal'].includes(classify(r,reference)))continue;
    const x=Math.floor(r.lon/dx),y=Math.floor(r.lat/dy),key=x+':'+y;
    if(!cells.has(key))cells.set(key,{bounds:[[y*dy,x*dx],[(y+1)*dy,(x+1)*dx]],rows:[]});cells.get(key).rows.push(r);
  }
  return [...cells.values()].map(c=>{
    const meanSpeed=c.rows.reduce((n,r)=>n+r.speed,0)/c.rows.length;
    const occupied=c.rows.filter(r=>Number.isFinite(r.occupancy));
    const meanOccupancy=occupied.length?occupied.reduce((n,r)=>n+r.occupancy,0)/occupied.length:null;
    const hotShare=c.rows.filter(r=>classify(r,reference)==='hot').length/c.rows.length;
    const slowShare=c.rows.filter(r=>r.speed<20).length/c.rows.length;
    let fill;if(metric==='speed')fill=meanSpeed<20?'#da6250':meanSpeed<40?'#dba33d':'#359680';
    else if(metric==='occupancy')fill=meanOccupancy===null?'#9ba8a0':meanOccupancy>=50?'#da6250':meanOccupancy>=25?'#dba33d':'#359680';
    else fill=hotShare>0?'#da6250':slowShare>0?'#dba33d':'#359680';
    return {...c,meanSpeed,meanOccupancy,hotShare,slowShare,fill,opacity:metric==='evidence'?0.12+0.48*Math.max(hotShare,slowShare):0.42};
  });
}
