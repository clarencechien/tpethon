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
