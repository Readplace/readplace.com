// Generate BPMN renderings of the event-storming snapshots under `.architecture/`.
//
// For every Mermaid `flowchart` block found in a snapshot's Markdown, this emits
// a sibling `diagrams-bpmn/<name>.png` (BPMN-notation render) and a matching
// `<name>.bpmn` (valid BPMN 2.0 XML, openable in Camunda Modeler / bpmn.io).
// See README.md for the event-storming -> BPMN element mapping.
//
//   npm install @resvg/resvg-js          # one-off; not a workspace dependency
//   run with no arguments to write the diagrams into the repo
//   run in debug mode with <fileSubstr>/<nameSubstr> filters to render to a temp dir for inspection
import fs from 'node:fs';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { walk, extractBlocks, parseMermaid, ROOT } from './parse.mjs';
import { layout } from './render.mjs';
import { buildSVG } from './draw.mjs';
import { buildBPMN } from './bpmn.mjs';

function renderPng(svg){
  const resvg = new Resvg(svg, {
    font: { fontDirs:['/usr/share/fonts'], defaultFontFamily:'DejaVu Sans', loadSystemFonts:true },
    fitTo: { mode:'zoom', value:2 },
  });
  return resvg.render().asPng();
}

function processBlock(b){
  const g = parseMermaid(b.src);
  const L = layout(g);
  return { g, L, svg: buildSVG(L, g, b.name), bpmn: buildBPMN(L, g, b.name) };
}

// de-duplicate diagram names within a single snapshot folder
function dedupe(blocks){
  const seen = new Map();
  for(const b of blocks){
    const n = seen.get(b.name) || 0;
    seen.set(b.name, n+1);
    if(n) b.name = `${b.name}-${n+1}`;
  }
  return blocks;
}

const mode = process.argv[2];
const mds = walk(ROOT).filter(f => f.endsWith('.md') && path.basename(f) !== 'index.md');

if(mode === 'debug'){
  const fsub = process.argv[3] || '', nsub = process.argv[4] || '';
  fs.mkdirSync('/tmp/out', { recursive:true });
  let k = 0;
  for(const f of mds){
    if(fsub && !f.includes(fsub)) continue;
    for(const b of dedupe(extractBlocks(f))){
      if(nsub && !b.name.includes(nsub)) continue;
      const { g, L, svg, bpmn } = processBlock(b);
      const base = `/tmp/out/${path.basename(path.dirname(f))}__${b.name}`;
      fs.writeFileSync(base + '.svg', svg);
      fs.writeFileSync(base + '.png', renderPng(svg));
      fs.writeFileSync(base + '.bpmn', bpmn);
      console.log(`${path.basename(path.dirname(f))}/${b.name}: ${g.nodes.size} nodes, ${g.edges.length} edges, ${L.W}x${L.H}px`);
      k++;
    }
  }
  console.log(`\n${k} diagram(s) -> /tmp/out`);
} else {
  let count = 0;
  for(const f of mds){
    const blocks = dedupe(extractBlocks(f));
    if(!blocks.length) continue;
    const dir = path.join(path.dirname(f), 'diagrams-bpmn');
    fs.mkdirSync(dir, { recursive:true });
    for(const b of blocks){
      const { svg, bpmn } = processBlock(b);
      fs.writeFileSync(path.join(dir, b.name + '.png'), renderPng(svg));
      fs.writeFileSync(path.join(dir, b.name + '.bpmn'), bpmn);
      count++;
    }
    console.log(`${path.relative(ROOT, path.dirname(f))}: ${blocks.length} diagram(s)`);
  }
  console.log(`\nTOTAL ${count} BPMN diagrams generated.`);
}
