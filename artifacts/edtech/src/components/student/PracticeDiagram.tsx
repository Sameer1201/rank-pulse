import { Fragment, useId } from "react";
import { CircuitSymbol, circuitSymbolKind, circuitLabelPosition, twoTerminalKinds } from "./CircuitSymbol";

export type DiagramPoint = { x: number; y: number };
export type DiagramElement = DiagramPoint & { kind: string; x2: number; y2: number; text?: string; bend?: number; order?: number; points?: DiagramPoint[] };
export type Diagram = { version?: number; kind?: string; title?: string; elements?: DiagramElement[] };
const activeKinds = ["transistor", "npn", "pnp", "mosfet", "nmos", "pmos", "opamp"];
const center = (e: DiagramElement, version?: number) => version === 2 ? { x:e.x,y:e.y } : { x:(e.x+e.x2)/2,y:(e.y+e.y2)/2 };
const displayText = (text: string) => text.replace(/\$/g,"").replace(/\\Omega/g,"Ω").replace(/\\omega/g,"ω").replace(/\\pi/g,"π").replace(/\\beta/g,"β").replace(/\\mu/g,"μ");

function Label({ x, y, text, anchor="middle", size=12 }: { x:number; y:number; text?:string; anchor?:"start"|"middle"|"end"; size?:number }) {
  if (!text) return null;
  const parts=displayText(text).split(/([_^](?:\{[^}]+\}|[A-Za-z0-9]+))/g);
  return <text x={x} y={y} textAnchor={anchor} fontSize={size} fill="currentColor" stroke="none">{parts.map((part,i)=>/^[_^]/.test(part)
    ? <tspan key={i} baselineShift={part[0]==="_"?"sub":"super"} fontSize="75%">{part.slice(1).replace(/[{}]/g,"")}</tspan>
    : <Fragment key={i}>{part}</Fragment>)}</text>;
}

function branchShape(e: DiagramElement) {
  const dx=e.x2-e.x,dy=e.y2-e.y,length=Math.hypot(dx,dy),bend=e.bend||0;
  if (length<1 && bend) {
    const radius=Math.abs(bend), sign=Math.sign(bend);
    return {d:`M${e.x} ${e.y} C${e.x-radius} ${e.y-sign*radius*1.7} ${e.x+radius} ${e.y-sign*radius*1.7} ${e.x} ${e.y}`,label:{x:e.x,y:e.y-sign*radius*1.28-10},bounds:[{x:e.x-radius,y:e.y-sign*radius*1.7},{x:e.x+radius,y:e.y}]};
  }
  const control={x:(e.x+e.x2)/2-(length?dy/length:0)*bend,y:(e.y+e.y2)/2+(length?dx/length:0)*bend};
  return {d:bend?`M${e.x} ${e.y} Q${control.x} ${control.y} ${e.x2} ${e.y2}`:`M${e.x} ${e.y} L${e.x2} ${e.y2}`,label:{x:(e.x+2*control.x+e.x2)/4,y:(e.y+2*control.y+e.y2)/4-10},bounds:[control]};
}

export function diagramViewBox(diagram: Diagram) {
  const points: DiagramPoint[]=[];
  const labelBounds=(x:number,y:number,text?:string,anchor="middle")=>{
    if (!text) return;
    const width=displayText(text).length*7;
    const left=anchor==="start"?x:anchor==="end"?x-width:x-width/2;
    points.push({x:left-4,y:y-17},{x:left+width+4,y:y+9});
  };
  for (const e of diagram.elements||[]) {
    const c=activeKinds.includes(e.kind)?center(e,diagram.version):e;
    if (e.kind === "atom") points.push({x:e.x-24,y:e.y-28},{x:e.x+24,y:e.y+28});
    points.push({x:c.x-45,y:c.y-50},{x:c.x+45,y:c.y+50},{x:e.x2+20,y:e.y2+35},...(e.points||[]));
    if (["branch","arrow","feedback","arc"].includes(e.kind)) {
      const shape=branchShape(e);points.push(...shape.bounds);labelBounds(shape.label.x,shape.label.y,e.text);
    } else if (["label","text","input","output"].includes(e.kind)) labelBounds(e.x,e.y,e.text,"start");
    else if (["wire","line","axis","ray","dimension"].includes(e.kind)) labelBounds(e.x2+10,e.y2+15,e.text,"start");
    else if (twoTerminalKinds.includes(circuitSymbolKind(e.kind))) {
      const label=circuitLabelPosition(e);
      labelBounds(label.x,label.y,e.text,label.anchor);
    } else labelBounds(c.x,c.y-39,e.text);
    if (e.kind==="circle") {
      const r=Math.hypot(e.x2-e.x,e.y2-e.y)||18;points.push({x:e.x-r,y:e.y-r},{x:e.x+r,y:e.y+r});
    }
  }
  const minX=Math.min(0,...points.map(p=>p.x))-16, minY=Math.min(0,...points.map(p=>p.y))-16;
  const maxX=Math.max(300,...points.map(p=>p.x))+16,maxY=Math.max(180,...points.map(p=>p.y))+16;
  return {x:minX,y:minY,width:maxX-minX,height:maxY-minY};
}

export default function PracticeDiagram({ diagram }: { diagram?:Diagram|null }) {
  const id=useId().replace(/:/g,"");
  if (!diagram?.elements?.length) return null;
  const arrow=`url(#practice-arrow-${id})`,branchArrow=`url(#practice-branch-${id})`;
  const bounds=diagramViewBox(diagram);
  const draw=(e:DiagramElement,index:number)=>{
    const length=Math.hypot(e.x2-e.x,e.y2-e.y);
    const c=center(e,diagram.version);
    if (["label","text","input","output"].includes(e.kind)) return <Label key={index} x={e.x} y={e.y} text={e.text} anchor="start" />;
    if (["node","sfg-node","point"].includes(e.kind)) return <g key={index}><circle cx={e.x} cy={e.y} r={e.kind==="sfg-node"?5:3} fill="currentColor"/><Label x={e.x} y={e.y+23} text={e.text}/></g>;
    if (e.kind==="ground") return <g key={index} transform={`translate(${e.x} ${e.y})`}><path d="M0 0v10m-12 0h24m-19 5h14m-10 5h6"/><Label x={18} y={16} text={e.text} anchor="start"/></g>;
    if (e.kind==="atom") return <g key={index} data-symbol="atom"><circle cx={e.x} cy={e.y} r="18" fill="var(--background,#fff)"/><Label x={e.x} y={e.y+5} text={e.text} size={14}/></g>;
    if (e.kind==="bond") {
      const dx=e.x2-e.x,dy=e.y2-e.y,length=Math.hypot(dx,dy)||1,order=Math.max(1,Math.min(3,Math.round(e.order||1))),nx=-dy/length,ny=dx/length,offset=order===2?4:5;
      const lines=Array.from({length:order},(_,line)=>{const shift=(line-(order-1)/2)*offset;return <path key={line} d={`M${e.x+nx*shift} ${e.y+ny*shift}L${e.x2+nx*shift} ${e.y2+ny*shift}`}/>;});
      return <g key={index} data-symbol="bond">{lines}</g>;
    }
    if (["transistor","npn","pnp"].includes(e.kind)) return <g key={index} transform={`translate(${c.x} ${c.y})`} data-symbol={e.kind}>
      <path d="M-30 0H-9M-9 -14V14M-9 -8L20 -22V-30M-9 8L20 22V30"/>
      <polygon points={e.kind==="pnp"?"-4,10 5,9 1,17":"14,19 5,12 3,20"} fill="currentColor" stroke="none"/>
      <Label x={-33} y={-7} text="B"/><Label x={30} y={-28} text="C"/><Label x={30} y={34} text="E"/><Label x={-3} y={-39} text={e.text}/>
    </g>;
    if (["mosfet","nmos","pmos"].includes(e.kind)) return <g key={index} transform={`translate(${c.x} ${c.y})`} data-symbol={e.kind}>
      <path d="M-30 0H-13M-13 -18V18M-4 -18V-8M-4 -5V5M-4 8V18M-4 -14H20V-30M-4 14H20V30M7 14V0H-4"/>
      <polygon points={e.kind==="pmos"?"7,0 0,-4 0,4":"-4,0 3,-4 3,4"} fill="currentColor" stroke="none"/>
      <Label x={-33} y={-7} text="G"/><Label x={30} y={-28} text="D"/><Label x={30} y={34} text="S"/><Label x={-3} y={-39} text={e.text}/>
    </g>;
    if (e.kind==="opamp") return <g key={index} transform={`translate(${c.x} ${c.y})`} data-symbol="opamp"><path d="M-18 -26L22 0L-18 26ZM-30 -15H-18M-30 15H-18M22 0H30"/><Label x={-9} y={-10} text="+"/><Label x={-9} y={19} text="−"/><Label x={0} y={-36} text={e.text}/></g>;
    if (e.kind==="block" || ["gate","mass","beam"].includes(e.kind)) return <g key={index}><rect x={Math.min(e.x,e.x2)} y={Math.min(e.y,e.y2)} width={Math.max(1,Math.abs(e.x2-e.x))} height={Math.max(1,Math.abs(e.y2-e.y))} rx="3"/><Label x={(e.x+e.x2)/2} y={(e.y+e.y2)/2+4} text={e.text}/></g>;
    if (["mixer","summing"].includes(e.kind)) {
      const signs=e.text?.split(",")||[];
      return <g key={index}><circle cx={e.x} cy={e.y} r="16"/>{e.kind==="mixer"?<><path d={`M${e.x-7} ${e.y-7}l14 14m-14 0l14 -14`}/><Label x={e.x} y={e.y-26} text={e.text}/></>:<><Label x={e.x-8} y={e.y+3} text={signs[0]}/><Label x={e.x} y={e.y-5} text={signs[1]}/><Label x={e.x} y={e.y+13} text={signs[2]}/></>}</g>;
    }
    if (["branch","arrow","feedback","arc"].includes(e.kind)) {
      const shape=branchShape(e);
      return <g key={index} data-symbol={e.kind}><path d={shape.d} markerEnd={e.kind==="arc"?undefined:e.kind==="branch"?branchArrow:arrow}/><Label {...shape.label} text={e.text}/></g>;
    }
    if (["curve","plot","wave"].includes(e.kind)) {
      // Missing samples must not be fabricated into a plausible waveform.
      if (!e.points?.length) return null;
      return <g key={index} data-symbol={e.kind}><polyline points={e.points.map(p=>`${p.x},${p.y}`).join(" ")} strokeWidth="2"/><Label x={e.x} y={e.y-12} text={e.text}/></g>;
    }
    if (e.kind==="stem" || e.kind==="impulse") return <g key={index} data-symbol={e.kind}><path d={`M${e.x} ${e.y}L${e.x2} ${e.y2}`} markerEnd={e.kind==="impulse"?arrow:undefined}/>{e.kind==="stem"?<circle cx={e.x2} cy={e.y2} r="3" fill="currentColor"/>:null}<Label x={e.x2} y={e.y2-10} text={e.text}/></g>;
    if (["wire","line","axis","ray","dimension"].includes(e.kind)) return <g key={index}><path d={`M${e.x} ${e.y}L${e.x2} ${e.y2}`} markerEnd={["axis","ray"].includes(e.kind)?arrow:undefined}/><Label x={e.x2+10} y={e.y2+15} text={e.text} anchor="start"/></g>;
    if (twoTerminalKinds.includes(circuitSymbolKind(e.kind))) {
      const label=circuitLabelPosition(e);
      return <g key={index}><CircuitSymbol element={e} arrow={arrow}/><Label {...label} text={e.text}/></g>;
    }
    if (["polygon","triangle"].includes(e.kind)) return <g key={index}><polygon points={e.points?.map(p=>`${p.x},${p.y}`).join(" ")||`${e.x},${e.y2} ${(e.x+e.x2)/2},${e.y} ${e.x2},${e.y2}`}/><Label x={(e.x+e.x2)/2} y={e.y2+20} text={e.text}/></g>;
    if (e.kind==="circle") return <g key={index}><circle cx={e.x} cy={e.y} r={length||18}/><Label x={e.x} y={e.y+4} text={e.text}/></g>;
    if (e.kind==="mirror") return <path key={index} d={`M${e.x} ${e.y}L${e.x2} ${e.y2}`} strokeWidth="3"/>;
    if (e.kind==="lens") return <path key={index} d={`M${e.x} ${e.y}Q${e.x-15} ${(e.y+e.y2)/2} ${e.x} ${e.y2}Q${e.x+15} ${(e.y+e.y2)/2} ${e.x} ${e.y}`}/>;
    return null;
  };
  return <div className="my-4 min-w-0 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border bg-background p-3 text-foreground" tabIndex={0} aria-label="Scrollable question diagram">
    <svg viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`} preserveAspectRatio="xMidYMid meet" className="mx-auto block w-full" style={{minWidth:Math.max(360,bounds.width),maxWidth:Math.max(640,bounds.width)}} role="img" aria-label={diagram.title||"Question diagram"}>
      <title>{diagram.title||"Question diagram"}</title>
      <defs>{[false,true].map(branch=><marker key={String(branch)} id={`practice-${branch?"branch":"arrow"}-${id}`} markerWidth="7" markerHeight="7" refX={branch?9:6} refY="3" orient="auto" markerUnits="userSpaceOnUse"><path d="M0 0L6 3L0 6Z" fill="currentColor"/></marker>)}</defs>
      <g stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round">
        {[...diagram.elements].sort((a,b)=>Number(["node","sfg-node","label","text"].includes(a.kind))-Number(["node","sfg-node","label","text"].includes(b.kind))).map(draw)}
      </g>
    </svg>
  </div>;
}
