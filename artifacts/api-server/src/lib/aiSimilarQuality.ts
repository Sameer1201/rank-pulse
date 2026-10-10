import { componentPins, diagramNetlist, twoTerminalKinds, type DiagramElement, type DiagramPoint } from "./aiDiagram";

export type AiSimilarDiagram = { kind: string; version?: number; elements: DiagramElement[] } | null;
const near = (a: DiagramPoint, b: DiagramPoint) => Math.hypot(a.x-b.x,a.y-b.y) < 1;
const onWire = (p: DiagramPoint, e: DiagramElement) => {
  const length = Math.hypot(e.x2-e.x,e.y2-e.y);
  if (!length) return near(p,e);
  const cross = Math.abs((p.x-e.x)*(e.y2-e.y)-(p.y-e.y)*(e.x2-e.x))/length;
  const dot = (p.x-e.x)*(e.x2-e.x)+(p.y-e.y)*(e.y2-e.y);
  return cross < 0.5 && dot >= -0.5 && dot <= length*length+0.5;
};

function circuitIssue(elements: DiagramElement[]): string | null {
  const devices = elements.map((element,index) => ({element,index,pins:componentPins(element)})).filter(item=>item.pins.length);
  const wires = elements.filter(e=>e.kind === "wire");
  for (const {element,index,pins} of devices) {
    for (let pin=0;pin<pins.length;pin++) {
      const attached = wires.some(w=>onWire(pins[pin],w)) || devices.some(other=>other.index!==index && other.pins.some(p=>near(p,pins[pin])));
      if (!attached) return `${element.text || element.kind} has a disconnected terminal at (${pins[pin].x},${pins[pin].y}). Connect this exact pin.`;
    }
    if (pins.length===2 && Math.hypot(pins[0].x-pins[1].x,pins[0].y-pins[1].y)<36) return `${element.kind} endpoints are too close to draw its symbol.`;
  }
  const netlist=diagramNetlist({version:2,kind:'circuit',elements})!;
  for(const device of netlist){
    const nets=Object.values(device.terminals);
    if(nets.length===2 && new Set(nets).size===1 && !['switch','switch-closed'].includes(device.kind)) return `${device.label} is shorted by a wire or ground connection.`;
  }
  // Walk wires only: a component must not be bypassed by a wire short.
  const sameNet = (a: DiagramPoint,b: DiagramPoint) => {
    const seen = new Set<number>();
    const queue = wires.map((wire,index)=>onWire(a,wire)?index:-1).filter(index=>index>=0);
    while (queue.length) {
      const index = queue.pop()!;
      if (seen.has(index)) continue;
      seen.add(index);
      const wire=wires[index];
      if (onWire(b,wire)) return true;
      wires.forEach((other,j)=>{
        if (!seen.has(j) && ([{x:wire.x,y:wire.y},{x:wire.x2,y:wire.y2}].some(p=>onWire(p,other)) || [{x:other.x,y:other.y},{x:other.x2,y:other.y2}].some(p=>onWire(p,wire)))) queue.push(j);
      });
    }
    return false;
  };
  for (const {element,pins} of devices) {
    if (["source","voltage-source","ac-source","current-source","resistor","capacitor","inductor","diode","zener"].includes(element.kind) && sameNet(pins[0],pins[1])) return `${element.text || element.kind} is shorted by a wire.`;
    if (pins.length===3 && sameNet(pins[0],pins[1]) && sameNet(pins[1],pins[2])) return `${element.kind} has all three terminals shorted together.`;
  }
  return null;
}

export function similarQuestionVisualIssue(reference: string, generated: string, diagram: AiSimilarDiagram, visualRequired: boolean): string | null {
  if (!diagram) return visualRequired ? "The required diagram is missing." : null;
  if (diagram.elements.length < 3) return "The diagram is too sparse.";
  const context = `${reference} ${generated}`;
  const elements = diagram.elements;
  const has = (...kinds: string[]) => elements.some(e=>kinds.includes(e.kind));
  const labels = elements.map(e=>e.text || "").join(" ");
  const isSfg = /\b(sfg|signal[- ]flow|mason)\b/i.test(context) || diagram.kind === "signal-flow";
  const isOrganic = /\b(organic|compound|molecule|alkane|alkene|alkyne|benzene|aromatic|isomer|functional group|iupac|stereochemistry|reaction mechanism)\b/i.test(context);
  if (isOrganic) {
    if (diagram.kind !== "molecule") return "Organic chemistry needs a molecular structure diagram, not an electrical circuit.";
    const atoms=elements.filter(e=>e.kind==='atom'),bonds=elements.filter(e=>e.kind==='bond');
    if(atoms.length<2||!bonds.length)return "The molecular diagram needs labelled atoms and bonds.";
    if(atoms.some(atom=>!atom.text?.trim()))return "Every atom in the molecular diagram needs an element label.";
    const points=atoms.map(atom=>({x:atom.x,y:atom.y}));
    for(const bond of bonds){if(!points.some(p=>near(p,bond))||!points.some(p=>near(p,{x:bond.x2,y:bond.y2})))return "Every molecular bond must connect two labelled atoms.";const order=bond.order;if(order==null||!Number.isInteger(order)||order<1||order>3)return "Molecular bonds must have order 1, 2 or 3.";}
    const carbon=atoms.filter(atom=>/^C/.test(atom.text||'')).length;
    if(/\b(alkane|alkene|alkyne|benzene|carbon|hydrocarbon)\b/i.test(context)&&!carbon)return "This hydrocarbon diagram needs carbon atoms.";
    return null;
  }
  if (isSfg) {
    const nodes=elements.filter(e=>["node","sfg-node"].includes(e.kind));
    const edges=elements.filter(e=>["branch","arrow","feedback"].includes(e.kind));
    if (nodes.length<2 || !edges.length) return "SFG requires signal nodes and directed gain branches, not block boxes.";
    if (nodes.some(node=>!node.text?.trim())) return "Every SFG signal node needs a label.";
    for (const edge of edges) {
      if (!edge.text?.trim()) return "Every SFG branch needs its signed gain.";
      if (!nodes.some(n=>near(n,edge)) || !nodes.some(n=>near(n,{x:edge.x2,y:edge.y2}))) return "SFG branch endpoints must be exactly on signal nodes.";
      if (near(edge,{x:edge.x2,y:edge.y2}) && !edge.bend) return "SFG self-loops need nonzero bend to show their direction and gain.";
    }
    if (nodes.some(n=>!edges.some(e=>near(n,e)||near(n,{x:e.x2,y:e.y2})))) return "The SFG contains an isolated signal node.";
    for (let i=0;i<edges.length;i++) for (let j=i+1;j<edges.length;j++) {
      const a=edges[i], b=edges[j];
      const same=near(a,b)&&near({x:a.x2,y:a.y2},{x:b.x2,y:b.y2});
      const reverse=near(a,{x:b.x2,y:b.y2})&&near(b,{x:a.x2,y:a.y2});
      if ((same && (a.bend||0)===(b.bend||0)) || (reverse && (a.bend||0)===-(b.bend||0))) return "SFG branches overlap. Give parallel/feedback branches separate bend values.";
    }
    return null;
  }
  const isCircuit = diagram.kind === "circuit" || has(...twoTerminalKinds,"transistor","npn","pnp","mosfet","nmos","pmos","opamp","diode","zener");
  const isMos = /\b(mosfet|nmos|pmos|common[- ]source|common[- ]gate|common[- ]drain)\b/i.test(context);
  const isBjt = /\b(bjt|common[- ]emitter|common[- ]collector|common[- ]base|collector current|base current)\b/i.test(context) || (!isMos && /\btransistor\b/i.test(context));
  if (isCircuit && isBjt && !has("transistor","npn","pnp")) return "A BJT circuit must contain an NPN/PNP transistor, with B, C and E terminals.";
  if (isCircuit && isMos && !has("mosfet","nmos","pmos")) return "A MOSFET circuit must contain an NMOS/PMOS symbol with G, D and S terminals; a BJT is not interchangeable.";
  if (isCircuit && /\b(op[ -]?amp|operational amplifier)\b/i.test(context) && !has("opamp")) return "An op-amp circuit must contain an op-amp symbol.";
  if (isCircuit && /\bdiode\b/i.test(context) && !has("diode","zener","schottky","led","photodiode")) return "A diode circuit must show the diode and cathode bar.";
  if (isCircuit && (isBjt||isMos) && /\b(amplifier|voltage gain)\b/i.test(context)) {
    if (!has("resistor","resistor-iec","variable-resistor") || !has("ground") || !has("source","voltage-source","current-source","battery","cell")) return "The amplifier needs its load/bias network, supply and ground.";
    if (!(has("input")||/\b(v[_ ]?i(?:n)?|input)\b/i.test(labels)) || !(has("output")||/\b(v[_ ]?o(?:ut)?|output)\b/i.test(labels))) return "Mark the amplifier input and output.";
  }
  if (isCircuit) {
    const issue=circuitIssue(elements);
    if (issue) return issue;
  }
  if (/\bblock diagram\b/i.test(context) || diagram.kind === "control-system") {
    if (!has("block","mixer","summing") || !has("arrow","feedback")) return "A block diagram needs labelled processing blocks and directed connections.";
    const connectors=elements.filter(e=>["arrow","feedback","wire","line"].includes(e.kind));
    for(const block of elements.filter(e=>["block","mixer","summing"].includes(e.kind))){
      const touches=(p:DiagramPoint)=>block.kind==='block'
        ? p.x>=Math.min(block.x,block.x2)-1&&p.x<=Math.max(block.x,block.x2)+1&&p.y>=Math.min(block.y,block.y2)-1&&p.y<=Math.max(block.y,block.y2)+1&&Math.min(Math.abs(p.x-block.x),Math.abs(p.x-block.x2),Math.abs(p.y-block.y),Math.abs(p.y-block.y2))<1
        : Math.abs(Math.hypot(p.x-block.x,p.y-block.y)-16)<1;
      if(!connectors.some(e=>touches(e)||touches({x:e.x2,y:e.y2}))) return `${block.text||block.kind} is disconnected from the signal path. Connect arrows at its boundary.`;
    }
    if (elements.some(e=>["block","mixer"].includes(e.kind)&&!e.text?.trim())) return "Label every processing block and mixer.";
  }
  if (["graph","waveform"].includes(diagram.kind)) {
    if (elements.filter(e=>e.kind==="axis").length<2 || !has("curve","plot","wave","stem","impulse")) return "A signal plot needs two labelled axes and a trace or discrete stems.";
    if (elements.filter(e=>e.kind==="axis").some(e=>!e.text?.trim())) return "Signal axes need variable/unit labels.";
    if (!has("label","text","point") && !elements.some(e=>["stem","impulse"].includes(e.kind)&&e.text)) return "Add numeric scale/tick or sample labels so the waveform can be interpreted.";
    if (elements.some(e=>["curve","plot","wave"].includes(e.kind)&&(!e.points||e.points.length<2))) return "Waveforms must contain explicit trace points.";
  }
  return null;
}
