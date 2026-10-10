export type DiagramPoint = { x: number; y: number };
export type DiagramElement = DiagramPoint & {
  kind: string; x2: number; y2: number; text?: string;
  bend?: number; order?: number; points?: DiagramPoint[];
};
export type PracticeDiagram = { version: 2; kind: string; title?: string; elements: DiagramElement[] };

export const twoTerminalKinds = [
  'resistor','resistor-iec','variable-resistor','capacitor','polarized-capacitor','inductor',
  'diode','zener','schottky','led','photodiode','battery','cell',
  'source','voltage-source','ac-source','current-source','dependent-voltage-source','dependent-current-source',
  'switch','switch-closed',
];
const aliases:Record<string,string>={
  'dc-source':'voltage-source','dc-voltage-source':'voltage-source','ac-voltage-source':'ac-source',
  'battery-cell':'cell','zener-diode':'zener','schottky-diode':'schottky','light-emitting-diode':'led',
  'photo-diode':'photodiode','electrolytic-capacitor':'polarized-capacitor','switch-open':'switch',
};
export const circuitSymbolKind=(kind:string)=>aliases[kind.toLowerCase().replace(/_/g,'-')]||kind.toLowerCase().replace(/_/g,'-');
export const diagramElementKinds = [...twoTerminalKinds, "wire", "transistor", "npn", "pnp", "mosfet", "nmos", "pmos", "opamp", "ground", "atom", "bond", "label", "text", "arrow", "branch", "block", "mixer", "summing", "node", "sfg-node", "input", "output", "feedback", "line", "axis", "curve", "plot", "point", "circle", "arc", "wave", "stem", "impulse", "ray", "dimension", "polygon", "triangle", "gate", "beam", "mass", "lens", "mirror"];
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
function plainDiagramLabel(value: string): string {
  const symbols:Record<string,string>={Omega:'Ω',omega:'ω',mu:'μ',beta:'β',alpha:'α',theta:'θ',pi:'π',Delta:'Δ'};
  return value.replace(/[\\¥](Omega|omega|mu|beta|alpha|theta|pi|Delta)\b/g,(_,name)=>symbols[name])
    .replace(/\\(?:mathrm|text)\{([^{}]*)\}/g,'$1').replace(/\$/g,'').slice(0,100);
}
const coordinate = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > 2000) throw new Error("AI_SIMILAR_DIAGRAM_INVALID_COORDINATE");
  return value;
};

/** A source feeding series/parallel branches is laid out from connectivity, not guessed pixels. */
function branchCircuit(value: Record<string, unknown>): DiagramElement[] {
  if(!record(value.source)||!Array.isArray(value.branches)||!value.branches.length||value.branches.length>4)throw new Error('AI_SIMILAR_INVALID_BRANCH_CIRCUIT');
  const source=value.source;
  const sourceKinds=['battery','cell','source','voltage-source','ac-source','current-source'];
  if(typeof source.kind!=='string'||!sourceKinds.includes(circuitSymbolKind(source.kind))||typeof source.text!=='string'||!source.text.trim())throw new Error('AI_SIMILAR_INVALID_CIRCUIT_SOURCE');
  const branches=value.branches.map(branch=>{
    if(!record(branch)||!Array.isArray(branch.components)||!branch.components.length||branch.components.length>5)throw new Error('AI_SIMILAR_INVALID_CIRCUIT_BRANCH');
    return branch.components.map(component=>{
      if(!record(component)||typeof component.kind!=='string'||!twoTerminalKinds.includes(circuitSymbolKind(component.kind))||typeof component.text!=='string'||!component.text.trim()||typeof component.reversed!=='boolean')throw new Error('AI_SIMILAR_INVALID_BRANCH_COMPONENT');
      return {kind:circuitSymbolKind(component.kind),text:component.text.slice(0,100),reversed:component.reversed};
    });
  });
  const height=Math.max(...branches.map(b=>b.length))*100;
  const top=60,bottom=top+height,right=60+branches.length*220;
  const elements:DiagramElement[]=[
    {kind:circuitSymbolKind(source.kind),text:source.text.slice(0,100),x:60,y:top,x2:60,y2:bottom},
    {kind:'wire',x:60,y:top,x2:right,y2:top},
    {kind:'wire',x:60,y:bottom,x2:right,y2:bottom},
    {kind:'ground',x:60,y:bottom,x2:60,y2:bottom},
  ];
  branches.forEach((branch,i)=>{
    const x=60+(i+1)*220,step=height/branch.length;
    branch.forEach((component,j)=>{
      const y1=top+j*step,y2=top+(j+1)*step;
      elements.push({kind:component.kind,text:component.text,x,y:component.reversed?y2:y1,x2:x,y2:component.reversed?y1:y2});
    });
    for(const y of [top,bottom])elements.push({kind:'node',x,y,x2:x,y2:y});
  });
  return elements;
}

/** Convert molecule connectivity into a deterministic, readable 2-D structure. */
function molecularDiagram(value: Record<string, unknown>): DiagramElement[] {
  if (value.kind !== 'molecule' || !Array.isArray(value.atoms) || !Array.isArray(value.bonds) || value.atoms.length < 2 || value.atoms.length > 24 || value.bonds.length < 1 || value.bonds.length > 30) throw new Error('AI_SIMILAR_INVALID_MOLECULE');
  const allowed=/^(H|B|C|N|O|F|P|S|Cl|Br|I|Si|Na|K|Mg|Ca)$/i;
  const atoms=value.atoms.map(atom=>{
    if(!record(atom)||typeof atom.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{0,15}$/.test(atom.id)||typeof atom.element!=='string'||!allowed.test(atom.element)|| (atom.charge!==undefined && (typeof atom.charge!=='number'||!Number.isInteger(atom.charge)||Math.abs(atom.charge)>3))) throw new Error('AI_SIMILAR_INVALID_MOLECULE_ATOM');
    return {id:atom.id,element:atom.element.length===2?atom.element[0].toUpperCase()+atom.element.slice(1).toLowerCase():atom.element.toUpperCase(),charge:atom.charge as number|undefined};
  });
  const ids=new Set(atoms.map(atom=>atom.id));
  if(ids.size!==atoms.length)throw new Error('AI_SIMILAR_DUPLICATE_MOLECULE_ATOM');
  const bonds=value.bonds.map(bond=>{
    if(!record(bond)||typeof bond.from!=='string'||typeof bond.to!=='string'||bond.from===bond.to||!ids.has(bond.from)||!ids.has(bond.to)||typeof bond.order!=='number'||!Number.isInteger(bond.order)||bond.order<1||bond.order>3)throw new Error('AI_SIMILAR_INVALID_MOLECULE_BOND');
    return {from:bond.from,to:bond.to,order:bond.order};
  });
  const adjacency=new Map(atoms.map(atom=>[atom.id,[] as string[]]));
  for(const bond of bonds){adjacency.get(bond.from)!.push(bond.to);adjacency.get(bond.to)!.push(bond.from);}
  const seen=new Set<string>(),queue=[atoms[0].id];
  while(queue.length){const id=queue.shift()!;if(seen.has(id))continue;seen.add(id);queue.push(...adjacency.get(id)!.filter(next=>!seen.has(next)));}
  if(seen.size!==atoms.length)throw new Error('AI_SIMILAR_DISCONNECTED_MOLECULE');
  const positions=new Map<string,DiagramPoint>();
  const isRing=bonds.length===atoms.length && atoms.every(atom=>adjacency.get(atom.id)!.length===2);
  if(isRing){const cx=280,cy=190,r=Math.max(90,Math.min(145,atoms.length*17));atoms.forEach((atom,index)=>{const angle=-Math.PI/2+index*2*Math.PI/atoms.length;positions.set(atom.id,{x:cx+r*Math.cos(angle),y:cy+r*Math.sin(angle)});});}
  else {
    const start=atoms.find(atom=>adjacency.get(atom.id)!.length===1)?.id||atoms[0].id;
    const levels=new Map<string,number>([[start,0]]),walk=[start];
    while(walk.length){const id=walk.shift()!;for(const next of adjacency.get(id)!)if(!levels.has(next)){levels.set(next,levels.get(id)!+1);walk.push(next);}}
    const grouped=new Map<number,string[]>();for(const atom of atoms){const level=levels.get(atom.id)??0;if(!grouped.has(level))grouped.set(level,[]);grouped.get(level)!.push(atom.id);}
    for(const [level,group] of grouped){const spread=Math.max(70,(group.length-1)*70);group.forEach((id,index)=>positions.set(id,{x:80+level*125,y:190-spread/2+index*70}));}
  }
  const elements:DiagramElement[]=atoms.map(atom=>{const point=positions.get(atom.id)!;const charge=atom.charge?atom.charge>0?`^${atom.charge>1?atom.charge:''}+`:`^${Math.abs(atom.charge)>1?Math.abs(atom.charge):''}−`:'';return {kind:'atom',x:point.x,y:point.y,x2:point.x,y2:point.y,text:`${atom.element}${charge}`};});
  for(const bond of bonds){const from=positions.get(bond.from)!,to=positions.get(bond.to)!;elements.push({kind:'bond',x:from.x,y:from.y,x2:to.x,y2:to.y,order:bond.order});}
  return elements;
}

export function normalizeAiDiagram(value: unknown): PracticeDiagram | null {
  if (value == null) return null;
  if (!record(value)) throw new Error("AI_SIMILAR_DIAGRAM_INVALID");
  let elements: unknown[] = Array.isArray(value.elements) ? value.elements : [];
  if(value.atoms !== undefined || value.bonds !== undefined) {
    if(elements.length)throw new Error('AI_SIMILAR_AMBIGUOUS_MOLECULE_FORMAT');
    elements=molecularDiagram(value);
  }
  if(value.branches !== undefined || value.source !== undefined) {
    if(value.kind !== 'circuit')throw new Error('AI_SIMILAR_INVALID_BRANCH_CIRCUIT');
    if(elements.length)throw new Error('AI_SIMILAR_AMBIGUOUS_CIRCUIT_FORMAT');
    elements=branchCircuit(value);
  }
  if (!elements.length && ["series", "parallel"].includes(String(value.layout))) {
    const resistances = Array.isArray(value.resistances) ? value.resistances.map(Number) : [];
    const voltage = Number(value.voltage);
    if (!resistances.length || resistances.length > 3 || resistances.some(r => !Number.isFinite(r) || r <= 0) || !Number.isFinite(voltage) || voltage <= 0) throw new Error("AI_SIMILAR_INVALID_CIRCUIT");
    elements = [{kind:"source",x:35,y:35,x2:35,y2:145,text:`${voltage} V`},{kind:"wire",x:35,y:145,x2:330,y2:145}];
    if (value.layout === "series") {
      elements.push({kind:"wire",x:35,y:35,x2:65,y2:35},{kind:"wire",x:330,y:35,x2:330,y2:145});
      const step = 265 / resistances.length;
      resistances.forEach((r,i) => elements.push({kind:"resistor",x:65+i*step,y:35,x2:65+(i+1)*step,y2:35,text:`${r} Ω`}));
    } else {
      elements.push({kind:"wire",x:35,y:35,x2:330,y2:35});
      resistances.forEach((r,i) => elements.push({kind:"resistor",x:120+i*85,y:35,x2:120+i*85,y2:145,text:`${r} Ω`}));
    }
  }
  if (!elements.length || elements.length > 100) throw new Error("AI_SIMILAR_DIAGRAM_ELEMENT_COUNT");
  return {
    version: 2, kind: typeof value.kind === "string" ? value.kind.slice(0,40) : "circuit",
    title: typeof value.title === "string" ? value.title.slice(0,160) : undefined,
    elements: elements.map(element => {
      if (!record(element) || typeof element.kind !== "string") throw new Error("AI_SIMILAR_DIAGRAM_UNSUPPORTED_SYMBOL");
      const kind=circuitSymbolKind(element.kind);
      if (!diagramElementKinds.includes(kind)) throw new Error("AI_SIMILAR_DIAGRAM_UNSUPPORTED_SYMBOL");
      const x = coordinate(element.x), y = coordinate(element.y);
      const points = element.points === undefined ? undefined : Array.isArray(element.points) && element.points.length >= 2 && element.points.length <= 128
        ? element.points.map(point => { if (!record(point)) throw new Error("AI_SIMILAR_DIAGRAM_INVALID_POINTS"); return {x:coordinate(point.x),y:coordinate(point.y)}; })
        : (() => { throw new Error("AI_SIMILAR_DIAGRAM_INVALID_POINTS"); })();
      if (["curve","plot","wave"].includes(element.kind) && !points) throw new Error("AI_SIMILAR_DIAGRAM_CURVE_NEEDS_POINTS");
      return {kind,x,y,x2:element.x2 == null ? x : coordinate(element.x2),y2:element.y2 == null ? y : coordinate(element.y2),
        text: typeof element.text === "string" ? plainDiagramLabel(element.text) : undefined,
        bend: element.bend === undefined ? undefined : coordinate(element.bend), order: element.order === undefined ? undefined : coordinate(element.order), points};
    }),
  };
}

/** Version 2 coordinates are actual terminals, never decorative bounding boxes. */
export function componentPins(e: DiagramElement): DiagramPoint[] {
  if (["transistor","npn","pnp","mosfet","nmos","pmos"].includes(e.kind)) return [{x:e.x-30,y:e.y},{x:e.x+20,y:e.y-30},{x:e.x+20,y:e.y+30}];
  if (e.kind === "opamp") return [{x:e.x-30,y:e.y-15},{x:e.x-30,y:e.y+15},{x:e.x+30,y:e.y}];
  if (twoTerminalKinds.includes(e.kind)) return [{x:e.x,y:e.y},{x:e.x2,y:e.y2}];
  if (e.kind === "ground") return [{x:e.x,y:e.y}];
  return [];
}

export function prefersBranchCircuit(context: string): boolean {
  return /\b(series|parallel)\b/i.test(context) && /\b(diode|battery|resistor|capacitor|inductor|rlc)\b/i.test(context)
    && !/\b(bjt|transistor|mosfet|nmos|pmos|op.?amp|amplifier|bridge|transformer|dependent|controlled|thevenin|norton|multi.?source)\b/i.test(context);
}

export function prefersMoleculeDiagram(context: string): boolean {
  return /\b(organic|compound|molecule|alkane|alkene|alkyne|benzene|aromatic|isomer|functional group|iupac|stereochemistry|reaction mechanism)\b/i.test(context);
}

export function diagramInstructions(context: string, branchesOnly = false): string {
  if (branchesOnly) return 'Return visual as a separate JSON object with version=2, kind="circuit", title, source:{kind,text}, and branches:[{components:[{kind,text,reversed}]}]. Do not put JSON or drawing instructions inside the question text. source.kind is battery or cell for DC battery plates, voltage-source for an ideal DC supply, ac-source for a sinusoidal AC supply, or current-source. A battery is DC, never AC. Give every component a name and value using plain Unicode labels (R1 = 2 kΩ), never dollar signs or LaTeX commands. Each branch runs from the supply top terminal to ground; components are connected in series in array order, and multiple branches are in parallel. Set reversed=false for a forward-biased diode (anode at top, cathode below), reversed=true to reverse polarity. Use diode, zener, schottky, led, photodiode as appropriate, never a generic circle. Use resistor, capacitor or inductor for passive elements. No coordinates, wires, ground or elements array: the server draws these from the connections. Preserve this topology family while varying reasoning for the requested difficulty. State all needed values, polarities and assumptions in the question. For AC specify amplitude and frequency. This format supports a single supply feeding branches; do not invent a bridge or transistor circuit.';
  if (prefersMoleculeDiagram(context)) return 'Return visual as a separate JSON object with version=2, kind="molecule", title, and explicit atom/bond connectivity. Do not put JSON or drawing instructions inside the question text. Use atoms:[{id,element,charge?}] where element is a real symbol such as C,H,O,N,Cl,Br,S or P, and bonds:[{from,to,order}] where order is 1 single, 2 double or 3 triple. Include every atom needed to understand the organic compound, including heteroatoms and hydrogens when they affect the structure, functional group or stereochemistry. Use unique short atom ids (C1,O1,N1). Bond endpoints must reference atom ids exactly; the server lays out the structure and draws bond order, so do not provide coordinates, elements or wires. Keep all atoms in one connected molecule. For rings, connect the ring closure bond explicitly. Use charge for ions. The question must state the compound/structure and all values or conditions; vary substituent positions or functional groups only when chemically valid. Never return an electrical circuit, resistor, battery, generic circle or disconnected atoms.';
  const common = "Return visual version=2 with kind,title,elements. Use a 600 by 360 drawing area with generous margins and no overlapping labels. Every element needs kind,x,y,x2,y2,text; use empty text only for wires/junctions, and give each component its name/value; for a point or centered symbol set x2=x,y2=y. text is a short plain label (e.g. R1 = 2 kΩ, -H(s), Vout), not raw LaTeX. Never invent a generic diagram for a different problem. State all needed component values, polarities, connections and signal parameters in the question too.";
  const parts = [common];
  if (/\b(circuit|diode|battery|rectifier|resistor|capacitor|inductor|rlc)\b/i.test(context) && !/\b(bjt|transistor|mosfet|op.?amp|bridge|transformer)\b/i.test(context)) {
    parts.push('PREFER the reliable branch-circuit format when the new problem has one supply feeding series/parallel two-terminal branches: visual={version:2,kind:"circuit",title,source:{kind:"battery"|"cell"|"voltage-source"|"ac-source"|"current-source",text:"name and value"},branches:[{components:[{kind,text,reversed:false}]}]}. This format has NO elements or coordinates. Each branch runs from the supply positive/top node to ground/bottom; its components are in series in array order; multiple branches are in parallel. reversed=true reverses diode anode/cathode or a component polarity. Source first terminal is top, second terminal is ground. Example: source battery 12 V; one branch with diode D1 then resistor R1=2 kΩ creates a CLOSED forward-biased diode circuit. The server builds all symbols and wires. Use this only when it describes the exact required topology; otherwise use elements. Never use this format for bridge, transistor or opamp circuits.');
  }
  if (/\b(sfg|signal[- ]flow|mason)\b/i.test(context)) parts.push("For SFG use kind=signal-flow: sfg-node elements at each named signal and branch elements whose endpoints are exactly node coordinates. Every branch has a signed gain in text and a directed arrow. bend is the perpendicular displacement of a quadratic control point from the midpoint: use nonzero bend for parallel paths/feedback loops, opposite signs for separate arcs. A self-loop uses the same start/end node and nonzero bend. Never substitute block/summing boxes for SFG nodes. Example nodes R at (60,180), X at (220,180), Y at (460,180); branches R→X gain 1, X→Y gain G(s), Y→X gain -H(s) with bend=120.");
  else if (/\b(block diagram|communication|modulat|demodulat|mixer|receiver|transmitter)\w*/i.test(context)) parts.push("For signal-processing/communication block diagrams use kind=control-system, labelled block rectangles (x,y top-left; x2,y2 bottom-right), mixer or summing circles centered at x,y, and directed arrow/feedback elements connected to their boundaries. Mixer has × inside. A summing element text is comma-separated input signs in left,top,bottom order, e.g. '+,,−'. Show oscillator/carrier input, filters and branch directions when required; do not draw an electrical resistor network instead.");
  if (/\b(circuit|amplifier|bjt|transistor|diode|mosfet|nmos|pmos|op.?amp)\b/i.test(context)) parts.push("For circuits use kind=circuit. Two-terminal symbols (resistor,resistor-iec,variable-resistor,capacitor,polarized-capacitor,inductor,diode,zener,schottky,led,photodiode,battery,cell,voltage-source,ac-source,current-source,dependent-voltage-source,dependent-current-source,switch,switch-closed) connect exactly at (x,y) and (x2,y2); separate endpoints by at least 44. A diode's ANODE is (x,y), CATHODE/bar is (x2,y2). Use battery for DC battery plates or cell for a single cell: long plate/positive is the FIRST endpoint, short plate/negative is the SECOND. A battery is DC, never AC. Use ac-source for sinusoidal AC input, not battery or a generic circle; its label states amplitude and frequency. voltage-source is an ideal DC source with a circle and +/−; current-source has a directed arrow. Dependent sources use dependent-voltage-source or dependent-current-source (diamond outline) and a controlling expression in text. Use diode for PN diode, zener for Zener, schottky for Schottky, led for outward light arrows, photodiode for inward light arrows; all have anode FIRST, cathode SECOND. For polarized-capacitor the positive plate is FIRST. switch is open, switch-closed is closed. Do not draw symbols as circles/triangles/wires yourself. DC voltage source + is at (x,y), − at (x2,y2); current arrow is from first to second terminal. Use npn/pnp for BJT and nmos/pmos for MOSFET: upright device CENTER is (x,y); B/G terminal=(x−30,y), C/D=(x+20,y−30), E/S=(x+20,y+30). Wire all three exact terminal coordinates. NPN has only the emitter arrow; MOSFET has insulated gate and separate drain/source. opamp CENTER=(x,y), +=(x−30,y−15), −=(x−30,y+15), output=(x+30,y). ground attaches at (x,y). For element format, wire ONLY between distinct component terminals; never add a wire with the same endpoints as a component, because that shorts it. The complete circuit must return to the source second terminal. A ground symbol has one attachment at x,y, not at x2,y2. Use orthogonal wire elements, junction nodes at connected intersections, and no floating components or shorted source. Supply, bias/load network, ground, input and output must be complete for an amplifier. Do not use passive series/parallel layout for BJT/MOSFET/opamp circuits.");
  if (/\b(signal|waveform|spectrum|plot|graph|fourier|convolution|sampling|pulse|impulse)\b/i.test(context) && !/\b(sfg|signal[- ]flow|mason)\b/i.test(context)) parts.push("For a waveform or spectrum use kind=waveform or graph. Provide two labelled axis elements with units and explicit scale/tick labels. curve/plot/wave MUST have points:[{x,y},...] describing the actual mathematical trace (2–128 ordered points); a straight endpoint pair is insufficient. Use stem elements with a dot for discrete samples; use impulse elements with an arrow for Dirac impulses. Both run from the baseline to the signed amplitude and have numeric labels. Preserve negative amplitudes, discontinuities, shifts and widths; do not replace everything with a decorative sine wave. Render only a plot relevant to the asked concept.");
  return parts.join(" ");
}

/** Deterministic netlist lets the independent solver reason about connections, not pixel guesses. */
export function diagramNetlist(diagram: PracticeDiagram | null) {
  if (!diagram || diagram.kind !== 'circuit') return undefined;
  const devices=diagram.elements.map((element,index)=>({element,index,pins:componentPins(element)})).filter(d=>d.pins.length);
  const wires=diagram.elements.filter(e=>e.kind==='wire');
  const points:DiagramPoint[]=[];
  const devicePoints=devices.map(d=>d.pins.map(p=>{points.push(p);return points.length-1}));
  for(const wire of wires)points.push({x:wire.x,y:wire.y},{x:wire.x2,y:wire.y2});
  for(const e of diagram.elements)if(e.kind==='node')points.push(e);
  const parent=points.map((_,i)=>i);
  const root=(i:number):number=>parent[i]===i?i:(parent[i]=root(parent[i]));
  const join=(a:number,b:number)=>{parent[root(a)]=root(b)};
  for(let i=0;i<points.length;i++)for(let j=i+1;j<points.length;j++)if(Math.hypot(points[i].x-points[j].x,points[i].y-points[j].y)<1)join(i,j);
  for(const wire of wires){
    const dx=wire.x2-wire.x,dy=wire.y2-wire.y,len=Math.hypot(dx,dy);
    const on=points.map((p,i)=>({p,i})).filter(({p})=>{
      if(!len)return Math.hypot(p.x-wire.x,p.y-wire.y)<1;
      const dot=(p.x-wire.x)*dx+(p.y-wire.y)*dy;
      return Math.abs((p.x-wire.x)*dy-(p.y-wire.y)*dx)/len<0.5&&dot>=-0.5&&dot<=len*len+0.5;
    });
    for(const p of on.slice(1))join(on[0].i,p.i);
  }
  const grounds=devices.flatMap((d,i)=>d.element.kind==='ground'?devicePoints[i]:[]);
  for(const p of grounds.slice(1))join(grounds[0],p);
  const names=new Map<number,string>();
  if(grounds.length)names.set(root(grounds[0]),'GND');
  return devices.map((d,i)=>{
    const labels=['transistor','npn','pnp'].includes(d.element.kind)?['B','C','E']:
      ['mosfet','nmos','pmos'].includes(d.element.kind)?['G','D','S']:
      d.element.kind==='opamp'?['+','−','OUT']:
      ['diode','zener','schottky','led','photodiode'].includes(d.element.kind)?['A','K']:
      ['source','voltage-source','dependent-voltage-source','battery','cell','polarized-capacitor'].includes(d.element.kind)?['+','−']:d.element.kind==='ground'?['GND']:['1','2'];
    return {elementIndex:d.index,kind:d.element.kind,label:d.element.text||d.element.kind,terminals:Object.fromEntries(devicePoints[i].map((point,j)=>{
      const net=root(point);if(!names.has(net))names.set(net,`N${names.size+1}`);
      return [labels[j],names.get(net)!];
    }))};
  });
}
