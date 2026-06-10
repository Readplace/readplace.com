import { routeEdge } from './draw.mjs';
const esc = s => String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const NID = id => 'n_'+id;

function elementFor(n){
  const k=n.bk.kind;
  if(k==='datastore') return {tag:'dataStoreReference', def:null};
  if(k==='gateway')   return {tag:'exclusiveGateway', def:null};
  if(k==='task'){
    const m=n.bk.marker;
    return {tag: m==='service'?'serviceTask': m==='send'?'sendTask': m==='user'?'userTask': m==='rule'?'businessRuleTask':'task', def:null};
  }
  // event
  const sub=n.bk.sub;
  if(sub==='start') return {tag:'startEvent', def:'message'};
  if(sub==='catch') return {tag:'intermediateCatchEvent', def:'message'};
  if(sub==='intermediateThrow') return {tag:'intermediateThrowEvent', def:'message'};
  if(sub==='endError') return {tag:'endEvent', def:'error'};
  if(sub==='end') return {tag:'endEvent', def:'message'};
  return {tag:'endEvent', def:null}; // endPlain
}

export function buildBPMN(L, g, title){
  const nodes=L.nodes;
  const elem=new Map(nodes.map(n=>[n.id, elementFor(n)]));
  const isData=id=>elem.get(id).tag==='dataStoreReference';
  // classify edges
  const seq=[], assoc=[];
  g.edges.forEach((e,i)=>{ if(e.from===e.to) return; (isData(e.from)||isData(e.to)?assoc:seq).push({...e,id:'f_'+i}); });
  const incoming=new Map(nodes.map(n=>[n.id,[]])), outgoing=new Map(nodes.map(n=>[n.id,[]]));
  for(const e of seq){ outgoing.get(e.from).push(e.id); incoming.get(e.to).push(e.id); }

  const fe=[]; // flow elements
  for(const n of nodes){
    const {tag,def}=elem.get(n.id);
    const ins=incoming.get(n.id).map(f=>`      <bpmn:incoming>${f}</bpmn:incoming>`).join('\n');
    const outs=outgoing.get(n.id).map(f=>`      <bpmn:outgoing>${f}</bpmn:outgoing>`).join('\n');
    const body=[ins,outs].filter(Boolean).join('\n');
    const defXml = def==='message'? '\n      <bpmn:messageEventDefinition />'
                 : def==='error'?   '\n      <bpmn:errorEventDefinition />' : '';
    const inner = (body||defXml) ? `\n${body}${defXml}\n    ` : '';
    fe.push(`    <bpmn:${tag} id="${NID(n.id)}" name="${esc(oneLine(n.label))}">${inner}</bpmn:${tag}>`);
  }
  for(const e of seq) fe.push(`    <bpmn:sequenceFlow id="${e.id}" name="${esc(oneLine(e.label))}" sourceRef="${NID(e.from)}" targetRef="${NID(e.to)}" />`);
  for(const e of assoc) fe.push(`    <bpmn:association id="${e.id}" sourceRef="${NID(e.from)}" targetRef="${NID(e.to)}" associationDirection="${e.bidir?'Both':'One'}" />`);
  g.groups.forEach((grp,i)=>{ if(grp.members.size) fe.push(`    <bpmn:group id="grp_${i}" />`); });

  // DI
  const di=[];
  for(const n of nodes){
    const sb=n.sb;
    di.push(`      <bpmndi:BPMNShape id="${NID(n.id)}_di" bpmnElement="${NID(n.id)}">
        <dc:Bounds x="${r(sb.x)}" y="${r(sb.y)}" width="${r(sb.w)}" height="${r(sb.h)}" />
      </bpmndi:BPMNShape>`);
  }
  g.groups.forEach((grp,i)=>{ const mem=[...grp.members].map(id=>L.id2n.get(id)).filter(Boolean); if(!mem.length)return;
    const x0=Math.min(...mem.map(m=>m.x))-12,y0=Math.min(...mem.map(m=>m.y))-12,x1=Math.max(...mem.map(m=>m.x+m.w))+12,y1=Math.max(...mem.map(m=>m.y+m.h))+12;
    di.push(`      <bpmndi:BPMNShape id="grp_${i}_di" bpmnElement="grp_${i}">
        <dc:Bounds x="${r(x0)}" y="${r(y0)}" width="${r(x1-x0)}" height="${r(y1-y0)}" />
      </bpmndi:BPMNShape>`); });
  for(const e of [...seq,...assoc]){
    const sN=L.id2n.get(e.from), tN=L.id2n.get(e.to);
    const pts=routeEdge(sN,tN,L.VERT);
    const wps=pts.map(p=>`        <di:waypoint x="${r(p[0])}" y="${r(p[1])}" />`).join('\n');
    di.push(`      <bpmndi:BPMNEdge id="${e.id}_di" bpmnElement="${e.id}">\n${wps}\n      </bpmndi:BPMNEdge>`);
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" id="Definitions_${slug(title)}" targetNamespace="http://readplace.com/architecture/bpmn">
  <bpmn:process id="Process_${slug(title)}" name="${esc(title)}" isExecutable="false">
${fe.join('\n')}
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diagram_${slug(title)}">
    <bpmndi:BPMNPlane id="Plane_${slug(title)}" bpmnElement="Process_${slug(title)}">
${di.join('\n')}
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>
`;
}
const r = v => Math.round(v*100)/100;
const oneLine = s => String(s==null?'':s).replace(/\n/g,' ');
const slug = s => String(s).replace(/[^A-Za-z0-9]+/g,'_').replace(/^_|_$/g,'')||'d';
