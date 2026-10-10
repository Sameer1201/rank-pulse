import assert from 'node:assert/strict';
import {test,after} from 'node:test';
import {writeFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {diagrams,sfg,waveform} from '../../api-server/tests/fixtures/ai-diagrams.mjs';
const NativeMessageChannel=globalThis.MessageChannel;
const channels=[];
globalThis.MessageChannel=class extends NativeMessageChannel {constructor(){super();channels.push(this)}};
after(()=>{for(const channel of channels){channel.port1.close();channel.port2.close()}globalThis.MessageChannel=NativeMessageChannel});
const bundle=await build({stdin:{contents:"export {default as Diagram,diagramViewBox} from './src/components/student/PracticeDiagram';export {twoTerminalKinds,circuitSymbolKind} from './src/components/student/CircuitSymbol';export {twoTerminalKinds as serverKinds,circuitSymbolKind as serverKind} from '../api-server/src/lib/aiDiagram';export {renderToStaticMarkup} from 'react-dom/server.browser';export {createElement as h} from 'react';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic'});
const {Diagram,diagramViewBox,renderToStaticMarkup,h,twoTerminalKinds,circuitSymbolKind,serverKinds,serverKind}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64')).catch(error=>{console.error(error.message);process.exit(1)});
const render=diagram=>renderToStaticMarkup(h(Diagram,{diagram}));
test('each diagram renders named accessible SVG with dedicated device symbols',()=>{
  for(const [name,diagram] of Object.entries(diagrams)) {
    const doc=new JSDOM(render(diagram)).window.document;
    assert.equal(doc.querySelector('svg[role="img"]').getAttribute('aria-label'),diagram.title,name);
    assert(doc.querySelector('title').textContent);
    if(name==='amplifier')assert.equal(doc.querySelectorAll('[data-symbol="npn"]').length,1);
    if(name==='mosfet')assert.equal(doc.querySelectorAll('[data-symbol="nmos"]').length,1);
    if(name==='diode')assert.equal(doc.querySelectorAll('[data-symbol="diode"]').length,1);
  }
});
test('curved signed SFG branches and sample coordinates survive rendering',()=>{
  const s=new JSDOM(render(sfg)).window.document;
  assert(s.querySelector('[data-symbol="branch"] path[marker-end]'));
  assert([...s.querySelectorAll('[data-symbol="branch"] path')].some(p=>p.getAttribute('d').includes('Q')));
  assert(s.body.textContent.includes('−H(s)'));
  const wave=new JSDOM(render(waveform)).window.document;
  assert.equal(wave.querySelector('polyline').getAttribute('points'),'40,200 160,200 160,90 340,90 340,200 480,200');
  assert(wave.querySelector('[data-symbol="impulse"] path[marker-end]'));
});
test('multiple diagrams have distinct arrow definitions and content stays within viewbox',()=>{
  const html=renderToStaticMarkup(h('div',null,h(Diagram,{diagram:sfg}),h(Diagram,{diagram:sfg})));
  const doc=new JSDOM(html).window.document;
  const ids=[...doc.querySelectorAll('marker')].map(m=>m.id);
  assert.equal(ids.length,new Set(ids).size);
  for(const d of Object.values(diagrams)){
    const bounds=diagramViewBox(d);
    for(const element of d.elements)for(const point of [element,{x:element.x2,y:element.y2},...(element.points||[])]) {
      assert(point.x>=bounds.x&&point.x<=bounds.x+bounds.width,d.title);
      assert(point.y>=bounds.y&&point.y<=bounds.y+bounds.height,d.title);
    }
  }
});
test('legacy unsupported symbols never turn into a voltage source',()=>{
  const doc=new JSDOM(render({elements:[{kind:'unknown',x:0,y:0,x2:60,y2:0}]})).window.document;
  assert.equal(doc.querySelectorAll('circle').length,0);
});
const orientations=[[60,80,160,80],[260,40,260,140],[160,200,60,200],[260,260,260,160]];
const galleries=twoTerminalKinds.map(kind=>({version:2,kind:'circuit',title:kind,elements:orientations.map(([x,y,x2,y2])=>({kind,x,y,x2,y2,text:''}))}));
test('every generator symbol has a dedicated renderer in all four orientations',()=>{
 assert.deepEqual(twoTerminalKinds,serverKinds);
 for(const diagram of galleries){
   const html=render(diagram),doc=new JSDOM(html).window.document;
   assert.equal(doc.querySelectorAll('[data-symbol="'+diagram.title+'"]').length,4,diagram.title);
   assert.equal(doc.querySelectorAll('[data-part="leads"]').length,4,diagram.title);
   assert(!/NaN|Infinity/.test(html),diagram.title);
 }
 for(const kind of ['ac_voltage_source','battery-cell','dc-source','zener-diode','electrolytic-capacitor'])assert.equal(circuitSymbolKind(kind),serverKind(kind));
});
test('battery plates, diode cathodes and AC waveforms remain distinct when rotated',()=>{
 const get=kind=>new JSDOM(render(galleries.find(d=>d.title===kind))).window.document;
 assert.equal(get('battery').querySelectorAll('[data-part="battery-plates"]').length,4);
 assert.equal(get('battery').querySelectorAll('circle').length,0);
 assert.equal(get('diode').querySelectorAll('[data-part="cathode"]').length,4);
 const ac=get('ac-source');
 assert.equal(ac.querySelectorAll('circle').length,4);
 for(const wave of ac.querySelectorAll('[data-part="ac-wave"]'))assert(!wave.closest('[transform*="rotate"]'),'AC marking must stay upright');
 assert.equal(ac.body.textContent.includes('+'),false);
 assert.equal(get('dependent-voltage-source').querySelectorAll('circle').length,0);
});
test('molecule diagrams render labelled atoms and bond order without circuit symbols',()=>{
 const molecule={version:2,kind:'molecule',title:'Ethanol',elements:[
  {kind:'atom',x:60,y:100,x2:60,y2:100,text:'C'},{kind:'atom',x:180,y:100,x2:180,y2:100,text:'C'},{kind:'atom',x:300,y:100,x2:300,y2:100,text:'O'},
  {kind:'bond',x:60,y:100,x2:180,y2:100,order:1},{kind:'bond',x:180,y:100,x2:300,y2:100,order:2},
 ]};
 const doc=new JSDOM(render(molecule)).window.document;
 assert.equal(doc.querySelectorAll('[data-symbol="atom"]').length,3);
 assert.equal(doc.querySelectorAll('[data-symbol="bond"]').length,2);
 assert.equal(doc.querySelectorAll('[data-symbol="bond"] path').length,3);
 assert.match(doc.body.textContent,/C/);
 assert.equal(doc.querySelectorAll('[data-symbol="diode"]').length,0);
});
if(process.env.DIAGRAM_PREVIEW_PATH){
 const sections=galleries.map(diagram=>`<section><h2>${diagram.title}</h2>${render(diagram)}</section>`).join('');
 writeFileSync(process.env.DIAGRAM_PREVIEW_PATH,`<!doctype html><meta charset="utf-8"><title>Circuit symbol QA</title><style>body{font:16px system-ui;margin:24px;background:#0f141e;color:#e5e7eb}main{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}section{min-width:0;border:1px solid #384050;border-radius:14px;padding:16px}h2{font-size:18px}svg{width:100%;display:block}.overflow-x-auto{overflow-x:auto}</style><main>${sections}</main>`);
}
