import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Overridable via ARCH_ROOT so the generator can run from an out-of-tree checkout.
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = process.env.ARCH_ROOT || path.resolve(HERE, '..', '..');

export function walk(d){return fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>{
  if(e.name==='node_modules'||e.name==='tools') return [];
  const p=path.join(d,e.name);return e.isDirectory()?walk(p):[p];
});}

// ---- extract mermaid blocks from a markdown file, naming each ----
export function extractBlocks(file){
  const md = fs.readFileSync(file,'utf8');
  const lines = md.split('\n');
  const blocks=[];
  let lastImg=null;            // last diagrams/<name>.svg seen
  let lastHeading=null;        // last ## heading slug
  let i=0;
  while(i<lines.length){
    const line=lines[i];
    const img=line.match(/!\[[^\]]*\]\(([^)]*\/)?([\w.-]+)\.svg\)/);
    if(img){lastImg=img[2];i++;continue;}
    const h=line.match(/^#{1,6}\s+(.*)$/);
    if(h){lastHeading=h[1].toLowerCase().replace(/[`*]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,40);lastImg=null;i++;continue;}
    if(line.trim().startsWith('```mermaid')){
      const buf=[];i++;
      while(i<lines.length && !lines[i].trim().startsWith('```')){buf.push(lines[i]);i++;}
      i++; // skip closing ```
      const name = lastImg || lastHeading || `diagram-${blocks.length+1}`;
      blocks.push({name, src:buf.join('\n')});
      lastImg=null;
      continue;
    }
    i++;
  }
  return blocks;
}

// ---- node shape parsing ----
const OPENERS = [
  ['((','))','circle'],
  ['([','])','stadium'],
  ['[(',')]','cylinder'],
  ['[/','/]','parallelogram'],
  ['[\\','\\]','parallelogram'],
  ['{{','}}','hexagon'],
  ['[',']','rect'],
  ['(',')','round'],
  ['{','}','diamond'],
  ['>',']','flag'],
];

function readNode(s, i){
  const idm = /^[A-Za-z0-9_]+/.exec(s.slice(i));
  if(!idm) return null;
  const id = idm[0];
  let j = i + id.length;
  let shape=null, label=null;
  for(const [open,close,kind] of OPENERS){
    if(s.startsWith(open, j)){
      let k = j + open.length;
      // quoted label
      if(s[k]==='"'){
        const q = s.indexOf('"', k+1);
        label = s.slice(k+1, q);
        k = q+1;
        // skip to closer
        const c = s.indexOf(close, k);
        k = (c<0? k : c+close.length);
      } else {
        const c = s.indexOf(close, k);
        label = s.slice(k, c<0? s.length : c);
        k = (c<0? s.length : c+close.length);
      }
      shape=kind; j=k; break;
    }
  }
  // class suffix
  let cls=null;
  const cm = /^:::([A-Za-z0-9_]+)/.exec(s.slice(j));
  if(cm){cls=cm[1]; j+=cm[0].length;}
  return {id,label,shape,cls,end:j};
}

const CONNECTORS = [
  {re:/^\s*<--\s+(.+?)\s+-->\s*/, dashed:false, labelGroup:1, bidir:true}, // <-- x -->
  {re:/^\s*<-->\s*/, dashed:false, bidir:true},                            // <-->
  {re:/^\s*-\.->\s*/, dashed:true},                                        // -.->
  {re:/^\s*-\.(.+?)\.->\s*/, dashed:true, labelGroup:1},                    // -. x .->
  {re:/^\s*--\s+(.+?)\s+-->\s*/, dashed:false, labelGroup:1},               // -- x -->
  {re:/^\s*-->\s*/, dashed:false},                                         // -->
];

function readConnector(s,i){
  const rest = s.slice(i);
  for(const c of CONNECTORS){
    const m = c.re.exec(rest);
    if(m){
      let label = c.labelGroup? m[c.labelGroup].trim() : null;
      let end = i + m[0].length;
      if(s[end]==='|'){ // optional |label|
        const q = s.indexOf('|', end+1);
        const bl = s.slice(end+1, q).trim().replace(/^"|"$/g,'');
        label = bl || label;
        end = q+1;
        while(s[end]===' ')end++;
      }
      return {dashed:!!c.dashed, bidir:!!c.bidir, label:cleanLabel(label), end};
    }
  }
  return null;
}

const NAMED_ENTITIES = {
  nbsp:' ', lt:'<', gt:'>', quot:'"', apos:"'", le:'≤', ge:'≥',
  rarr:'→', larr:'←', harr:'↔', times:'×', hellip:'…',
  mdash:'—', ndash:'–', rsquo:'’', lsquo:'‘', rdquo:'”', ldquo:'“',
};
export function cleanLabel(t){
  if(t==null) return null;
  let s = String(t).replace(/<br\s*\/?>/gi,'\n');     // line breaks first
  s = s.replace(/<\/?(?:b|strong|i|em|u)\s*\/?>/gi,''); // strip inline formatting tags (content uses &lt;/&gt;)
  s = s.replace(/&#(\d+);/g, (_,n)=>String.fromCharCode(+n))
       .replace(/&#x([0-9a-fA-F]+);/g, (_,h)=>String.fromCharCode(parseInt(h,16)))
       .replace(/&([a-zA-Z]+);/g, (m,name)=> name==='amp'? m : (NAMED_ENTITIES[name] ?? m))
       .replace(/&amp;/g,'&');                          // decode &amp; last
  return s.replace(/^"|"$/g,'').trim();
}

export function parseMermaid(src){
  const nodes=new Map();
  const edges=[];
  const groups=[];
  const groupStack=[];
  let dir='TD';
  const ensure=(id)=>{ if(!nodes.has(id)) nodes.set(id,{id,label:null,shape:null,cls:null}); return nodes.get(id); };
  const note=(n)=>{
    const e=ensure(n.id);
    if(n.label!=null && (e.label==null)) e.label=cleanLabel(n.label);
    if(n.shape && !e.shape) e.shape=n.shape;
    if(n.cls){ if(!e.cls || e.cls==='new') e.cls=n.cls; } // prefer real role over 'new'
    for(const g of groupStack) g.members.add(n.id);
    return e;
  };
  for(let raw of src.split('\n')){
    let line = raw.replace(/\t/g,'    ');
    const t = line.trim();
    if(!t) continue;
    if(t.startsWith('%%')) continue;
    if(/^classDef\b/.test(t)) continue;
    if(/^(linkStyle|style|class)\b/.test(t)) continue;
    const fc = /^(?:flowchart|graph)\s+([A-Za-z]+)/.exec(t);
    if(fc){dir=fc[1].toUpperCase();continue;}
    if(/^subgraph\b/.test(t)){
      let title = t.replace(/^subgraph\s+/,'');
      const m = title.match(/^[\w-]+\s*\[\s*"?(.*?)"?\s*\]\s*$/); // subgraph id [Title] / id ["Title"]
      title = m ? m[1] : title.replace(/^"|"$/g,'');
      const g={title:title.trim(), members:new Set()}; groups.push(g); groupStack.push(g); continue;
    }
    if(t==='end'){ groupStack.pop(); continue; }
    if(/^direction\b/.test(t)) continue;
    // parse node/edge chain
    let i=0; const S=t; let guard=0; let prev=null;
    while(i<S.length && guard++<200){
      while(S[i]===' ')i++;
      if(i>=S.length)break;
      const node=readNode(S,i);
      if(!node){ break; }
      const e=note(node); i=node.end;
      while(S[i]===' ')i++;
      const conn=readConnector(S,i);
      if(conn){
        i=conn.end;
        const node2=readNode(S,i);
        if(node2){
          note(node2);
          edges.push({from:e.id,to:node2.id,label:conn.label,dashed:conn.dashed,bidir:conn.bidir});
          i=node2.end;
          let cur=node2.id, ci=i;            // continue an A-->B-->C chain
          while(true){
            while(S[ci]===' ')ci++;
            const cn=readConnector(S,ci); if(!cn)break;
            ci=cn.end; const n3=readNode(S,ci); if(!n3)break;
            note(n3); edges.push({from:cur,to:n3.id,label:cn.label,dashed:cn.dashed,bidir:cn.bidir});
            cur=n3.id; ci=n3.end;
          }
          i=ci;
        }
      }
      while(S[i]===' '||S[i]===';')i++;  // skip stray separators
      if(readNode(S,i)===null && readConnector(S,i)===null) break;
    }
  }
  return {dir, nodes, edges, groups};
}

// ---- self-test over all blocks ----
if(process.argv[2]==='test'){
  const mds = walk(ROOT).filter(f=>f.endsWith('.md') && !f.endsWith('index.md'));
  let totalBlocks=0, totalNodes=0, totalEdges=0;
  const clsSeen=new Map();
  for(const f of mds){
    for(const b of extractBlocks(f)){
      totalBlocks++;
      const g=parseMermaid(b.src);
      totalNodes+=g.nodes.size; totalEdges+=g.edges.length;
      for(const n of g.nodes.values()){const key=n.cls||'(none:'+n.shape+')'; clsSeen.set(key,(clsSeen.get(key)||0)+1);}
      // sanity: edges referencing unknown nodes?
      for(const e of g.edges){ if(!g.nodes.has(e.from)||!g.nodes.has(e.to)) console.log('  !! dangling edge',f,b.name,e); }
      // nodes with no label and no shape (pure phantom) -> often fine (bare ref) but report if also no edges
      const nolabel=[...g.nodes.values()].filter(n=>!n.label);
      if(nolabel.length) console.log(`  ?  ${path.basename(f)} / ${b.name}: ${nolabel.length} node(s) w/o label: ${nolabel.map(n=>n.id).join(',')}`);
    }
  }
  console.log(`\nBLOCKS=${totalBlocks} NODES=${totalNodes} EDGES=${totalEdges}`);
  console.log('CLASS/shape distribution:'); for(const [k,v] of [...clsSeen.entries()].sort((a,b)=>b[1]-a[1])) console.log(`  ${k}: ${v}`);
}
