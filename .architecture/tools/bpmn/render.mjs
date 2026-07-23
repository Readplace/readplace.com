// BPMN renderer: maps event-storming nodes -> BPMN elements, lays out, emits SVG + .bpmn
import { parseMermaid } from './parse.mjs';

const PALETTE = {
  command: { fill:'#a6d8ff', stroke:'#1e6fb8' },
  system:  { fill:'#fff2a8', stroke:'#a08a00' },
  event:   { fill:'#ffb976', stroke:'#a85800' },
  policy:  { fill:'#d6b8ff', stroke:'#6b3fb0' },
  store:   { fill:'#b8e8c5', stroke:'#2f7a45' },
  queue:   { fill:'#e8e8e8', stroke:'#666666' },
  dlq:     { fill:'#f8c8c8', stroke:'#a83434' },
  ui:      { fill:'#ffffff', stroke:'#222222' },
  task:    { fill:'#f4f4f4', stroke:'#555555' },
  gateway: { fill:'#ffe9a8', stroke:'#a08a00' },
};
const NEW = { fill:'#ffd24c', stroke:'#a0660b' };

const ROLE_OF_CLASS = {
  command:'command', cmd:'command',
  system:'system', sys:'system',
  event:'event', evt:'event',
  policy:'policy', pol:'policy',
  store:'store', read:'store',
  queue:'queue', dlq:'dlq', ui:'ui',
};

const PAST = /(Saved|Completed|Failed|Changed|Cancelled|Canceled|Scheduled|Succeeded|Reactivated|Refreshed|Unchanged|Extracted|Initiated|Requested|Deleted|Created|Generated|Exported|Promoted|Persisted|Received|Deferred|Confirmed)\b/;
const SYSTEMISH = /(Lambda|Handler|Express|App\b|Gateway|API\b|Scheduler|Worker|Receiver|Selector|select|stale-check|policy\b|main\.ts|\.ts\b|markCrawl|markSummary|saveArticle|crawl|parse|process|put|update|dispatch|create|store|find|list|reprime|promote|increment|decide|refresh|publish)/i;

function deriveRole(node){
  const cls = node.cls;
  if(cls && ROLE_OF_CLASS[cls]) return { role: ROLE_OF_CLASS[cls], isNew:false };
  const isNew = cls === 'new';
  // class is 'new' or absent -> infer from shape + label
  const L = node.label || '';
  switch(node.shape){
    case 'hexagon': return { role:'system', isNew };
    case 'cylinder': {
      if(/DLQ|dead.?letter/i.test(L)) return { role:'dlq', isNew };
      if(/queue|SQS/i.test(L)) return { role:'queue', isNew };
      return { role:'store', isNew };
    }
    case 'circle': {
      if(/^(done|noop|no-?op|terminal|skip|end|stop)\b/i.test(L) || /no-?op/i.test(L)) return { role:'policy', isNew };
      return { role:'event', isNew };
    }
    case 'diamond': return { role:'gateway', isNew };
    case 'stadium': case 'round': return { role:'command', isNew };
    case 'parallelogram': {
      if(/queue|SQS|DLQ/i.test(L)) return { role:'queue', isNew };
      return { role:'ui', isNew };
    }
    default: { // rect / flag / unknown
      if(/Command\b/.test(L)) return { role:'command', isNew };
      if(/Event\b/.test(L) || PAST.test(L) || /^Emit\b/.test(L)) return { role:'event', isNew };
      if(SYSTEMISH.test(L)) return { role:'system', isNew };
      return { role:'task', isNew };
    }
  }
}

// BPMN element kind decides the drawn shape
function bpmnKind(role, node, hasOut, hasIn){
  switch(role){
    case 'command': return { kind:'task', marker:'send' };
    case 'system':  return { kind:'task', marker:'service' };
    case 'task':    return { kind:'task', marker:null };
    case 'event':
      if(!hasIn && hasOut) return { kind:'event', sub:'start' };   // domain event that triggers this flow
      return hasOut ? { kind:'event', sub:'intermediateThrow' } : { kind:'event', sub:'end' };
    case 'policy': {
      const L=(node.label||'');
      if(!hasOut || /^(done|noop|no-?op|terminal|end|stop)\b/i.test(L) || /no-?op/i.test(L)) return { kind:'event', sub:'endPlain' };
      return { kind:'task', marker:'rule' };
    }
    case 'store':   return { kind:'datastore' };
    case 'queue':   return { kind:'event', sub:'catch' };
    case 'dlq':     return hasOut ? { kind:'event', sub:'catch' } : { kind:'event', sub:'endError' };
    case 'ui':      return hasIn ? { kind:'task', marker:'user' } : { kind:'event', sub:'start' };
    case 'gateway': return { kind:'gateway' };
    default:        return { kind:'task', marker:null };
  }
}

// ---------- text ----------
const FW = 0.60; // avg glyph advance factor for DejaVu Sans
function lineWidth(s, fs){ let w=0; for(const ch of s){ w += (/[ .,:;'"!|ilتj]/.test(ch)?0.34: /[mwMW@]/.test(ch)?0.92: /[A-Z0-9]/.test(ch)?0.68: 0.56)*fs; } return w; }
function wrap(text, fs, maxW){
  const out=[];
  for(const hard of String(text).split('\n')){
    const words = hard.split(/ /);
    let line='';
    for(const w of words){
      const trial = line? line+' '+w : w;
      if(lineWidth(trial,fs) <= maxW || !line){
        if(lineWidth(trial,fs) > maxW && !line){ // single long word: hard-split
          let chunk='';
          for(const ch of w){ if(lineWidth(chunk+ch,fs)>maxW && chunk){ out.push(chunk); chunk=ch; } else chunk+=ch; }
          line=chunk;
        } else line=trial;
      } else { out.push(line); line=w; }
    }
    if(line) out.push(line);
  }
  return out.length?out:[''];
}

// ---------- sizing ----------
function sizeNode(n){
  const r = deriveRole(n);
  n.role = r.role; n.isNew = r.isNew;
  n.bk = null; // assigned after edges known
  return r;
}
function finalizeSize(n, hasOut, hasIn){
  n.bk = bpmnKind(n.role, n, hasOut, hasIn);
  const kind = n.bk.kind;
  if(kind==='task'){
    const fs=12.5, lh=16, maxW=178;
    const lines=wrap(n.label, fs, maxW);
    const tw=Math.max(...lines.map(l=>lineWidth(l,fs)));
    n.w=Math.min(214, Math.max(104, tw+26));
    n.h=Math.max(48, lines.length*lh+20);
    n.lines=lines; n.fs=fs; n.lh=lh; n.labelInside=true;
    n.shape={x:0,y:0,w:n.w,h:n.h};
  } else if(kind==='gateway'){
    const fs=11.5, lh=14, maxW=150;
    const lines=wrap(n.label, fs, maxW);
    const tw=Math.max(...lines.map(l=>lineWidth(l,fs)));
    const d=Math.max(56, Math.min(86, tw*0.8));
    n.gw=d;
    n.w=Math.max(d, tw); n.h=d+4+lines.length*lh;
    n.lines=lines; n.fs=fs; n.lh=lh; n.labelInside=false;
  } else if(kind==='datastore'){
    const fs=11, lh=13.5, maxW=176;
    const lines=wrap(n.label, fs, maxW);
    const tw=Math.max(...lines.map(l=>lineWidth(l,fs)));
    const cw=Math.max(74, Math.min(190, tw+22)), ch=48;
    n.cw=cw; n.ch=ch;
    n.w=Math.max(cw,tw); n.h=ch+4+lines.length*lh;
    n.lines=lines; n.fs=fs; n.lh=lh; n.labelInside=false;
  } else { // event circle
    const fs=11, lh=13.5, maxW=150, d=40;
    const lines=wrap(n.label, fs, maxW);
    const tw=Math.max(...lines.map(l=>lineWidth(l,fs)));
    n.d=d;
    n.w=Math.max(d,tw); n.h=d+5+lines.length*lh;
    n.lines=lines; n.fs=fs; n.lh=lh; n.labelInside=false;
  }
}

// shape geometry (the actual glyph box, centered horizontally within node bbox top)
function shapeBox(n){
  const cx=n.x+n.w/2;
  if(n.bk.kind==='task') return {x:n.x,y:n.y,w:n.w,h:n.h,cx,cy:n.y+n.h/2,kind:'rect'};
  if(n.bk.kind==='gateway'){ const d=n.gw; return {x:cx-d/2,y:n.y,w:d,h:d,cx,cy:n.y+d/2,kind:'diamond'}; }
  if(n.bk.kind==='datastore'){ const w=n.cw,h=n.ch; return {x:cx-w/2,y:n.y,w,h,cx,cy:n.y+h/2,kind:'cyl'}; }
  const d=n.d; return {x:cx-d/2,y:n.y,w:d,h:d,cx,cy:n.y+d/2,kind:'circle',r:d/2};
}

// ---------- layout (layered) ----------
function layout(g){
  const nodes=[...g.nodes.values()];
  const id2n=new Map(nodes.map(n=>[n.id,n]));
  for(const n of nodes) sizeNode(n);
  const out=new Map(), inc=new Map();
  for(const n of nodes){ out.set(n.id,[]); inc.set(n.id,[]); }
  for(const e of g.edges){ if(e.from===e.to) continue; out.get(e.from).push(e.to); inc.get(e.from); inc.get(e.to).push(e.from); }
  for(const n of nodes) finalizeSize(n, out.get(n.id).length>0, inc.get(n.id).length>0);

  // detect back-edges via DFS
  const color=new Map(nodes.map(n=>[n.id,0]));
  const back=new Set();
  const dfs=(u)=>{ color.set(u,1); for(const v of out.get(u)){ if(color.get(v)===1) back.add(u+'>'+v); else if(color.get(v)===0) dfs(v);} color.set(u,2); };
  for(const n of nodes) if(color.get(n.id)===0) dfs(n.id);
  const fedges=g.edges.filter(e=>e.from!==e.to && !back.has(e.from+'>'+e.to));

  // longest-path ranks (Kahn)
  const indeg=new Map(nodes.map(n=>[n.id,0]));
  const fout=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of fedges){ indeg.set(e.to, indeg.get(e.to)+1); fout.get(e.from).push(e.to); }
  const rank=new Map(nodes.map(n=>[n.id,0]));
  const q=nodes.filter(n=>indeg.get(n.id)===0).map(n=>n.id);
  const seen=new Set(q);
  while(q.length){ const u=q.shift(); for(const v of fout.get(u)){ if(rank.get(v)<rank.get(u)+1) rank.set(v,rank.get(u)+1); indeg.set(v,indeg.get(v)-1); if(indeg.get(v)===0){ q.push(v); } } }

  const maxR=Math.max(0,...[...rank.values()]);
  const layers=Array.from({length:maxR+1},()=>[]);
  for(const n of nodes) layers[rank.get(n.id)].push(n.id);

  // barycenter ordering
  const pos=new Map();
  const reindex=()=>{ for(const L of layers) L.forEach((id,i)=>pos.set(id,i)); };
  reindex();
  const adjUp=new Map(nodes.map(n=>[n.id,[]])), adjDn=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of g.edges){ if(e.from===e.to)continue; if(rank.get(e.from)<rank.get(e.to)){ adjDn.get(e.from).push(e.to); adjUp.get(e.to).push(e.from);} else if(rank.get(e.from)>rank.get(e.to)){ adjDn.get(e.to).push(e.from); adjUp.get(e.from).push(e.to);} }
  const bary=(id,adj)=>{ const a=adj.get(id); if(!a.length)return pos.get(id); return a.reduce((s,x)=>s+pos.get(x),0)/a.length; };
  for(let it=0; it<6; it++){
    const down = it%2===0;
    const order = down ? [...layers.keys()] : [...layers.keys()].reverse();
    for(const r of order){
      const adj = down ? adjUp : adjDn;
      layers[r] = layers[r].map(id=>[id,bary(id,adj)]).sort((a,b)=>a[1]-b[1]).map(x=>x[0]);
      reindex();
    }
  }

  // assign coordinates
  const VERT = g.dir!=='LR' && g.dir!=='RL';
  const RANKGAP=58, NODEGAP=36, MARGIN=28;
  // sizes along rank axis
  let cursorRank=MARGIN;
  const rankPos=[];
  for(let r=0;r<layers.length;r++){
    const band = Math.max(0,...layers[r].map(id=>VERT? id2n.get(id).h : id2n.get(id).w));
    rankPos[r]={start:cursorRank, band};
    cursorRank += band + RANKGAP;
  }
  // cross positions, centered
  let maxCross=0;
  const crossOf=[];
  for(let r=0;r<layers.length;r++){
    let c=0; const arr=[];
    for(const id of layers[r]){ const n=id2n.get(id); const sz=VERT?n.w:n.h; arr.push({id,c,sz}); c+=sz+NODEGAP; }
    crossOf[r]=arr; maxCross=Math.max(maxCross, c-NODEGAP);
  }
  for(let r=0;r<layers.length;r++){
    const total = crossOf[r].length? crossOf[r][crossOf[r].length-1].c + crossOf[r][crossOf[r].length-1].sz : 0;
    const off = MARGIN + (maxCross-total)/2;
    for(const it of crossOf[r]){
      const n=id2n.get(it.id);
      const rp=rankPos[r];
      if(VERT){ n.x = off + it.c; n.y = rp.start + (rp.band-n.h)/2; }
      else    { n.y = off + it.c; n.x = rp.start + (rp.band-n.w)/2; }
    }
  }
  const W = (VERT? MARGIN*2+maxCross : cursorRank+MARGIN);
  const H = (VERT? cursorRank+MARGIN : MARGIN*2+maxCross);
  for(const n of nodes) n.sb=shapeBox(n);
  return { nodes, id2n, W:Math.ceil(W), H:Math.ceil(H), VERT };
}

export { layout, deriveRole, PALETTE, NEW, shapeBox };
