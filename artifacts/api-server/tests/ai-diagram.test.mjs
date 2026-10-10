import assert from 'node:assert/strict';
import {test} from 'node:test';
import {build} from 'esbuild';
import {diagrams,amplifier,mosfet,sfg,waveform} from './fixtures/ai-diagrams.mjs';
const bundle=await build({stdin:{contents:"export * from './src/lib/aiDiagram';export * from './src/lib/aiSimilarQuality';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'browser'});
const {normalizeAiDiagram,similarQuestionVisualIssue,diagramInstructions,diagramNetlist,prefersBranchCircuit,prefersMoleculeDiagram}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const check=(diagram,context='')=>similarQuestionVisualIssue(context,'',normalizeAiDiagram(diagram),true);
test('complete examples pass domain checks across all six visual families',()=>{
  for(const [name,diagram] of Object.entries(diagrams)) assert.equal(check(diagram,diagram.title),null,name);
});
test('BJT and MOSFET cannot be replaced by an unrelated circuit or each other',()=>{
  assert.match(check(mosfet,'BJT amplifier'),/BJT/);
  assert.match(check(amplifier,'MOSFET amplifier'),/MOSFET/);
  assert.match(check(diagrams.diode,'BJT amplifier'),/BJT/);
});
test('exact terminal connectivity and wire shorts are checked before solving',()=>{
  const missing=structuredClone(amplifier);missing.elements=missing.elements.filter(e=>e.kind!=='resistor'||!e.text.includes('R_C'));
  assert.match(check(missing,'BJT amplifier'),/disconnected terminal/);
  const short=structuredClone(amplifier);short.elements.push({kind:'wire',x:440,y:60,x2:440,y2:300});
  assert.match(check(short,'BJT amplifier'),/shorted/);
});
test('SFG preserves signed curved branches and rejects overlapping or dangling paths',()=>{
  assert.equal(normalizeAiDiagram(sfg).elements.at(-1).bend,-140);
  const overlap=structuredClone(sfg);overlap.elements.at(-1).bend=140;
  assert.match(check(overlap,'Mason signal-flow graph'),/overlap/);
  const missing=structuredClone(sfg);missing.elements.at(-1).x2=221;
  assert.match(check(missing,'SFG'),/endpoints/);
  const gain=structuredClone(sfg);delete gain.elements.at(-1).text;
  assert.match(check(gain,'SFG'),/signed gain/);
});
test('waveforms retain actual samples, negative impulses and axes rather than invented sine waves',()=>{
  const normalized=normalizeAiDiagram(waveform);
  assert.deepEqual(normalized.elements[2].points,waveform.elements[2].points);
  assert.equal(normalized.elements.at(-1).kind,'impulse');
  const missing=structuredClone(waveform);delete missing.elements[2].points;
  assert.throws(()=>normalizeAiDiagram(missing),/NEEDS_POINTS/);
  assert.equal(check(waveform,'MOSFET transfer characteristic plot'),null,'a transistor plot need not contain a transistor circuit');
});
test('unsupported symbols and invalid coordinates are rejected, never silently replaced',()=>{
  for(const element of [{kind:'fake-transistor',x:1,y:1},{kind:'npn',x:NaN,y:1},{kind:'npn',x:3000,y:1}]) {
    assert.throws(()=>normalizeAiDiagram({kind:'circuit',elements:[element]}),/AI_SIMILAR_DIAGRAM/);
  }
  assert.match(diagramInstructions('Control Systems SFG Mason'),/sfg-node/);
  assert.match(diagramInstructions('Analog MOSFET amplifier'),/G terminal/);
  assert.match(diagramInstructions('Communication demodulator'),/mixer/);
  assert.match(diagramInstructions('Signals waveform'),/points/);
});

test('computed netlist preserves transistor pins and common ground without joining unrelated nets',()=>{
 const nets=diagramNetlist(normalizeAiDiagram(amplifier));
 const q=nets.find(d=>d.kind==='npn');
 const rc=nets.find(d=>d.label.startsWith('R_C'));
 const re=nets.find(d=>d.label.startsWith('R_E'));
 assert.equal(q.terminals.C,rc.terminals['2']);
 assert.equal(q.terminals.E,re.terminals['1']);
 assert.notEqual(q.terminals.B,q.terminals.C);
 assert.equal(re.terminals['2'],'GND');
 assert.equal(nets.find(d=>d.kind==='voltage-source').terminals['−'],'GND');
 const bad=structuredClone(amplifier);bad.elements.push({kind:'ground',x:440,y:60,x2:440,y2:60});
 assert.match(check(bad,'BJT amplifier'),/shorted/);
});
test('unconnected communication processing blocks are rejected',()=>{
 const d=structuredClone(diagrams.communication);d.elements.find(e=>e.kind==='mixer').x+=10;
 assert.match(check(d,'Communication'),/disconnected/);
});

test('battery and diode variants preserve polarity in the netlist',()=>{
 for(const kind of ['battery','cell','dependent-voltage-source','polarized-capacitor','led','schottky','photodiode']){
  const diagram=normalizeAiDiagram({kind:'circuit',elements:[{kind,x:10,y:20,x2:100,y2:20,text:'X1'}]});
  const device=diagramNetlist(diagram)[0];
  const keys=Object.keys(device.terminals);
  assert.deepEqual(keys,['led','schottky','photodiode'].includes(kind)?['A','K']:['+','−']);
  assert.notEqual(device.terminals[keys[0]],device.terminals[keys[1]]);
 }
});
test('common explicit symbol aliases normalize without guessing from prose',()=>{
 for(const [name,expected] of [['AC_voltage_source','ac-source'],['battery-cell','cell'],['zener-diode','zener'],['dc-source','voltage-source']]){
  const d=normalizeAiDiagram({kind:'circuit',elements:[{kind:name,x:0,y:0,x2:80,y2:0}]});
  assert.equal(d.elements[0].kind,expected);
 }
 assert.match(diagramInstructions('Diode circuit'),/battery is DC, never AC/);
});

const branchExample=()=>({version:2,kind:'circuit',source:{kind:'battery',text:'V1 = 5 V'},branches:[{components:[{kind:'diode',text:'D1 = 0.7 V',reversed:false},{kind:'resistor',text:'R1 = 1 kΩ',reversed:false}]}]});
test('branch circuits build closed labelled series and parallel networks with exact polarity',()=>{
 const raw=branchExample();
 raw.branches.push({components:[{kind:'resistor',text:'R2 = 2 kΩ',reversed:false}]});
 const d=normalizeAiDiagram(raw);
 assert.equal(check(d,'Diode circuit'),null);
 assert.deepEqual(normalizeAiDiagram(d),d);
 const [battery,,diode,r1,r2]=diagramNetlist(d);
 assert.equal(battery.terminals['+'],diode.terminals.A);
 assert.equal(diode.terminals.K,r1.terminals['1']);
 assert.equal(r1.terminals['2'],'GND');
 assert.equal(battery.terminals['−'],'GND');
 assert.equal(r2.terminals['1'],battery.terminals['+']);
 assert.equal(r2.terminals['2'],'GND');
 raw.branches[0].components[0].reversed=true;
 const reversed=diagramNetlist(normalizeAiDiagram(raw)).find(e=>e.kind==='diode');
 assert.equal(reversed.terminals.K,battery.terminals['+']);
 assert.equal(reversed.terminals.A,r1.terminals['1']);
});
test('branch format rejects ambiguous, incomplete and unsupported circuits',()=>{
 const invalid=[
  {...branchExample(),kind:'waveform'},
  {...branchExample(),elements:[{kind:'wire',x:0,y:0,x2:1,y2:1}]},
  {...branchExample(),source:{kind:'npn',text:'Q1'}},
  {...branchExample(),branches:[]},
  {...branchExample(),branches:[{components:[{kind:'npn',text:'Q1',reversed:false}]}]},
  {...branchExample(),branches:[{components:[{kind:'diode',text:'D1'}]}]},
 ];
 for(const value of invalid)assert.throws(()=>normalizeAiDiagram(value),/AI_SIMILAR_/);
});

test('only explicit passive series/parallel references use the constrained branch schema',()=>{
 assert.equal(prefersBranchCircuit('series battery diode resistor circuit'),true);
 assert.equal(prefersBranchCircuit('parallel RLC circuit'),true);
 for(const context of ['BJT amplifier with series resistor','diode bridge rectifier','MOSFET and series resistor','series controlled source resistor circuit'])assert.equal(prefersBranchCircuit(context),false);
 assert.match(diagramInstructions('series diode circuit',true),/No coordinates/);
});

const ethanol={version:2,kind:'molecule',title:'Ethanol',atoms:[{id:'C1',element:'C'},{id:'C2',element:'C'},{id:'O1',element:'O'},{id:'H1',element:'H'}],bonds:[{from:'C1',to:'C2',order:1},{from:'C2',to:'O1',order:1},{from:'O1',to:'H1',order:1}]};
test('organic molecule connectivity becomes a readable structure with single, double and ring bonds',()=>{
 const d=normalizeAiDiagram(ethanol);
 assert.equal(d.kind,'molecule');
 assert.equal(d.elements.filter(e=>e.kind==='atom').length,4);
 assert.equal(d.elements.filter(e=>e.kind==='bond').length,3);
 assert.equal(check(d,'Organic Chemistry ethanol compound'),null);
 const ring=normalizeAiDiagram({version:2,kind:'molecule',title:'Benzene',atoms:Array.from({length:6},(_,i)=>({id:`C${i+1}`,element:'C'})),bonds:Array.from({length:6},(_,i)=>({from:`C${i+1}`,to:`C${(i+1)%6+1}`,order:i%2?1:2}))});
 assert.equal(check(ring,'Organic Chemistry benzene aromatic ring'),null);
 assert.equal(new Set(ring.elements.filter(e=>e.kind==='atom').map(e=>`${e.x},${e.y}`)).size,6);
});
test('organic diagrams reject electrical visuals and broken atom bonds',()=>{
 assert.match(check(diagrams.diode,'Organic Chemistry compound'),/molecular structure/);
 const broken=structuredClone(ethanol);broken.bonds[0].to='missing';assert.throws(()=>normalizeAiDiagram(broken),/AI_SIMILAR_INVALID_MOLECULE_BOND/);
 const disconnected=structuredClone(ethanol);disconnected.atoms.push({id:'N1',element:'N'});assert.throws(()=>normalizeAiDiagram(disconnected),/AI_SIMILAR_DISCONNECTED_MOLECULE/);
});
test('organic contexts select the molecule schema',()=>{
 assert.equal(prefersMoleculeDiagram('JAM Chemistry Organic Chemistry alkene'),true);
 assert.match(diagramInstructions('Organic Chemistry benzene'),/atoms:\[\{id,element/);
 assert.equal(prefersMoleculeDiagram('Analog Circuits diode'),false);
});
