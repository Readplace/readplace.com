import { PALETTE, NEW } from './render.mjs';

const esc = s => String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

function colorsFor(n){
  const base = PALETTE[n.role] || PALETTE.task;
  if(n.isNew) return { fill:NEW.fill, stroke:NEW.stroke };
  return base;
}

// ---- small BPMN markers (top-left of tasks ~14px) ----
function gear(x,y){ const cx=x+7,cy=y+7,r=5; let p=`<g stroke="#333" stroke-width="1" fill="none"><circle cx="${cx}" cy="${cy}" r="${r}"/>`;
  for(let a=0;a<8;a++){ const t=a*Math.PI/4; p+=`<line x1="${(cx+Math.cos(t)*r).toFixed(1)}" y1="${(cy+Math.sin(t)*r).toFixed(1)}" x2="${(cx+Math.cos(t)*(r+2)).toFixed(1)}" y2="${(cy+Math.sin(t)*(r+2)).toFixed(1)}"/>`; }
  p+=`<circle cx="${cx}" cy="${cy}" r="1.7" fill="#333"/></g>`; return p; }
function envelope(x,y,w=15,h=10,filled=false){ const f=filled?'#333':'none', s='#333';
  return `<g stroke="${s}" stroke-width="1" fill="${f}"><rect x="${x}" y="${y}" width="${w}" height="${h}"/><polyline points="${x},${y} ${x+w/2},${y+h*0.62} ${x+w},${y}" fill="none" stroke="${filled?'#fff':s}"/></g>`; }
function person(x,y){ const cx=x+7; return `<g stroke="#333" stroke-width="1" fill="none"><circle cx="${cx}" cy="${y+4}" r="2.6"/><path d="M${cx-4.5},${y+14} q4.5,-6 9,0"/></g>`; }
function table(x,y){ return `<g stroke="#333" stroke-width="0.9" fill="none"><rect x="${x}" y="${y+1}" width="14" height="11"/><line x1="${x}" y1="${y+5}" x2="${x+14}" y2="${y+5}"/><line x1="${x}" y1="${y+8.5}" x2="${x+14}" y2="${y+8.5}"/><line x1="${x+5}" y1="${y+1}" x2="${x+5}" y2="${y+12}"/></g>`; }
function bolt(cx,cy){ return `<path d="M${cx-1},${cy-6} L${cx-4},${cy+1} L${cx-1},${cy+1} L${cx+1.5},${cy+6} L${cx+4},${cy-1} L${cx+1},${cy-1} Z" fill="#a83434" stroke="#7a1f1f" stroke-width="0.6"/>`; }

// ---- node drawing ----
export function drawNode(n){
  const c = colorsFor(n);
  const sb = n.sb;
  let g='';
  const kind=n.bk.kind;
  if(kind==='task'){
    const sw = n.isNew? 2.4 : 1.6;
    g += `<rect x="${n.x.toFixed(1)}" y="${n.y.toFixed(1)}" width="${n.w.toFixed(1)}" height="${n.h.toFixed(1)}" rx="9" ry="9" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw}"/>`;
    const m=n.bk.marker;
    if(m==='service') g+=gear(n.x+5,n.y+5);
    else if(m==='send') g+=envelope(n.x+5,n.y+6,15,10,true);
    else if(m==='user') g+=person(n.x+5,n.y+5);
    else if(m==='rule') g+=table(n.x+5,n.y+5);
    g += text(n, n.x+n.w/2, n.y, n.h, 'middle', true);
  } else if(kind==='datastore'){
    const x=sb.x,y=sb.y,w=sb.w,h=sb.h, e=7;
    const sw=n.isNew?2.4:1.6;
    g += `<path d="M${x},${y+e} C${x},${y-e*0.6} ${x+w},${y-e*0.6} ${x+w},${y+e} L${x+w},${y+h-e} C${x+w},${y+h+e*0.6} ${x},${y+h+e*0.6} ${x},${y+h-e} Z" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw}"/>`;
    g += `<path d="M${x},${y+e} C${x},${y+e*2.2} ${x+w},${y+e*2.2} ${x+w},${y+e}" fill="none" stroke="${c.stroke}" stroke-width="1"/>`;
    g += text(n, sb.cx, sb.y+sb.h+3, n.h-sb.h-3, 'middle', false);
  } else if(kind==='gateway'){
    const d=sb.w, cx=sb.cx, cy=sb.cy;
    const sw=n.isNew?2.4:1.6;
    g += `<polygon points="${cx},${cy-d/2} ${cx+d/2},${cy} ${cx},${cy+d/2} ${cx-d/2},${cy}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw}"/>`;
    g += `<text x="${cx}" y="${cy+1}" font-size="15" text-anchor="middle" dominant-baseline="middle" fill="${c.stroke}">&#215;</text>`;
    g += text(n, sb.cx, sb.y+d+3, n.h-d-3, 'middle', false);
  } else { // event circle
    const cx=sb.cx, cy=sb.cy, r=sb.r;
    const sub=n.bk.sub;
    const sw = (sub==='end'||sub==='endError'||sub==='endPlain')? 3.2 : (n.isNew?2.2:1.7);
    g += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${c.fill}" stroke="${c.stroke}" stroke-width="${sw}"/>`;
    if(sub==='intermediateThrow'||sub==='catch') g += `<circle cx="${cx}" cy="${cy}" r="${r-3.3}" fill="none" stroke="${c.stroke}" stroke-width="1.2"/>`;
    // inner icon
    if(sub==='endError') g += bolt(cx,cy);
    else if(sub==='start'||sub==='catch') g += envelope(cx-7.5,cy-5,15,10,false);
    else if(sub==='intermediateThrow'||sub==='end') g += envelope(cx-7.5,cy-5,15,10,true);
    // endPlain: no icon (terminal/none)
    g += text(n, sb.cx, sb.y+sb.h+3, n.h-sb.h-3, 'middle', false);
  }
  return g;
}

function text(n, cx, top, avail, anchor, inside){
  const lines=n.lines, fs=n.fs, lh=n.lh;
  const blockH=lines.length*lh;
  let y = inside ? (n.y + (n.h-blockH)/2 + lh*0.78) : (top + lh*0.78);
  let out='';
  for(const ln of lines){ out += `<text x="${cx.toFixed(1)}" y="${y.toFixed(1)}" font-size="${fs}" text-anchor="${anchor}" fill="#111">${esc(ln)}</text>`; y+=lh; }
  return out;
}

// ---- edge routing ----
function borderPoint(sb, tx, ty){
  const cx=sb.cx, cy=sb.cy;
  const dx=tx-cx, dy=ty-cy;
  if(sb.kind==='circle'){ const L=Math.hypot(dx,dy)||1; return [cx+dx/L*sb.r, cy+dy/L*sb.r]; }
  // rect-like (also diamond/cyl approximated)
  const hw=sb.w/2, hh=sb.h/2;
  let sx=Infinity;
  if(dx!==0) sx=Math.abs(hw/dx);
  let sy=Infinity;
  if(dy!==0) sy=Math.abs(hh/dy);
  const t=Math.min(sx,sy);
  return [cx+dx*t, cy+dy*t];
}

export function routeEdge(sN, tN, VERT){
  const s=sN.sb, t=tN.sb;
  const forward = VERT ? (t.cy - s.cy > 4) : (t.cx - s.cx > 4);
  if(forward){
    if(VERT){
      const x1=s.cx, y1=s.y+s.h, x2=t.cx, y2=t.y;
      if(Math.abs(x1-x2)<2) return [[x1,y1],[x2,y2]];
      const my=(y1+y2)/2; return [[x1,y1],[x1,my],[x2,my],[x2,y2]];
    } else {
      const x1=s.x+s.w, y1=s.cy, x2=t.x, y2=t.cy;
      if(Math.abs(y1-y2)<2) return [[x1,y1],[x2,y2]];
      const mx=(x1+x2)/2; return [[x1,y1],[mx,y1],[mx,y2],[x2,y2]];
    }
  }
  // non-forward: straight border-to-border
  const a=borderPoint(s, t.cx, t.cy);
  const b=borderPoint(t, s.cx, s.cy);
  return [a,b];
}

export function drawEdge(pts, {dashed, assoc, bidir, label}){
  const stroke = assoc? '#2f7a45' : '#444';
  const da = (dashed||assoc)? ' stroke-dasharray="5 4"' : '';
  const poly = pts.map(p=>`${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  let g = `<polyline points="${poly}" fill="none" stroke="${stroke}" stroke-width="1.4"${da}/>`;
  const head = assoc? 'open' : 'solid';
  g += arrow(pts[pts.length-2], pts[pts.length-1], stroke, head);
  if(bidir) g += arrow(pts[1], pts[0], stroke, head);
  if(label){
    const mid = pts[Math.floor(pts.length/2)] || pts[0];
    const mx = (pts.length%2===0)? (pts[pts.length/2-1][0]+pts[pts.length/2][0])/2 : mid[0];
    const my = (pts.length%2===0)? (pts[pts.length/2-1][1]+pts[pts.length/2][1])/2 : mid[1];
    g += edgeLabel(label, mx, my);
  }
  return g;
}
function arrow(from,to,stroke,kind){
  const dx=to[0]-from[0], dy=to[1]-from[1]; const L=Math.hypot(dx,dy)||1; const ux=dx/L, uy=dy/L; const s=8;
  const a=[to[0]-ux*s-uy*s*0.5, to[1]-uy*s+ux*s*0.5];
  const b=[to[0]-ux*s+uy*s*0.5, to[1]-uy*s-ux*s*0.5];
  if(kind==='open') return `<polyline points="${a[0].toFixed(1)},${a[1].toFixed(1)} ${to[0].toFixed(1)},${to[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}" fill="none" stroke="${stroke}" stroke-width="1.4"/>`;
  return `<polygon points="${a[0].toFixed(1)},${a[1].toFixed(1)} ${to[0].toFixed(1)},${to[1].toFixed(1)} ${b[0].toFixed(1)},${b[1].toFixed(1)}" fill="${stroke}"/>`;
}
function edgeLabel(t, x, y){
  const fs=9.5; const lines=String(t).split('\n').slice(0,3);
  const w=Math.max(...lines.map(l=>l.length))*fs*0.55+6; const h=lines.length*11+3;
  let g=`<rect x="${(x-w/2).toFixed(1)}" y="${(y-h/2).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="#ffffff" fill-opacity="0.86" stroke="#ddd" stroke-width="0.5"/>`;
  let ty=y-h/2+9; for(const ln of lines){ g+=`<text x="${x.toFixed(1)}" y="${ty.toFixed(1)}" font-size="${fs}" text-anchor="middle" fill="#555">${esc(ln)}</text>`; ty+=11; }
  return g;
}

export function buildSVG(L, g, title){
  const parts=[];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${L.W}" height="${L.H}" viewBox="0 0 ${L.W} ${L.H}" font-family="DejaVu Sans, Liberation Sans, sans-serif">`);
  parts.push(`<rect width="${L.W}" height="${L.H}" fill="#ffffff"/>`);
  // groups (subgraphs) behind — per-group inflation so overlapping boxes stay distinguishable
  g.groups.forEach((grp,gi)=>{
    const mem=[...grp.members].map(id=>L.id2n.get(id)).filter(Boolean);
    if(mem.length<1) return;
    const pad=11+gi*7;
    const x0=Math.min(...mem.map(m=>m.x))-pad, y0=Math.min(...mem.map(m=>m.y))-pad;
    const x1=Math.max(...mem.map(m=>m.x+m.w))+pad, y1=Math.max(...mem.map(m=>m.y+m.h))+pad;
    parts.push(`<rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1-x0).toFixed(1)}" height="${(y1-y0).toFixed(1)}" rx="8" fill="none" stroke="#a9a9a9" stroke-width="1.1" stroke-dasharray="9 5"/>`);
    if(grp.title){
      const tw=grp.title.length*6.6+10, tx=x0+10;
      parts.push(`<rect x="${tx.toFixed(1)}" y="${(y0-9).toFixed(1)}" width="${tw.toFixed(1)}" height="17" rx="3" fill="#ffffff" stroke="#cfcfcf" stroke-width="0.7"/>`);
      parts.push(`<text x="${(tx+5).toFixed(1)}" y="${(y0+3).toFixed(1)}" font-size="11" fill="#777" font-style="italic">${esc(grp.title)}</text>`);
    }
  });
  // edges
  for(const e of g.edges){
    if(e.from===e.to) continue;
    const sN=L.id2n.get(e.from), tN=L.id2n.get(e.to); if(!sN||!tN)continue;
    const assoc = sN.role==='store' || tN.role==='store';
    const pts=routeEdge(sN,tN,L.VERT);
    parts.push(drawEdge(pts, {dashed:e.dashed, assoc, bidir:e.bidir, label:e.label}));
  }
  // nodes
  for(const n of L.nodes) parts.push(drawNode(n));
  parts.push('</svg>');
  return parts.join('\n');
}
