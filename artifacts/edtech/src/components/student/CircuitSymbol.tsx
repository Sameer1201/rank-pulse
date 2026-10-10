/** Two-terminal symbols use exact endpoints; only the leads stretch, never the symbol body. */
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
export type CircuitElement={kind:string;x:number;y:number;x2:number;y2:number};
export function circuitLabelPosition(e:CircuitElement) {
  const vertical=Math.abs(e.y2-e.y)>Math.abs(e.x2-e.x)*0.7;
  return {x:(e.x+e.x2)/2+(vertical?32:0),y:(e.y+e.y2)/2-(vertical?5:38),anchor:vertical?'start' as const:'middle' as const};
}
function Mark({x,y,children}:{x:number;y:number;children:string}) {
  return <text x={x} y={y} fill="currentColor" stroke="none" fontSize="12" fontFamily="Arial, sans-serif" textAnchor="middle" dominantBaseline="central">{children}</text>;
}
export function CircuitSymbol({element:e,arrow}:{element:CircuitElement;arrow:string}) {
  const kind=circuitSymbolKind(e.kind),dx=e.x2-e.x,dy=e.y2-e.y,length=Math.hypot(dx,dy);
  if(!twoTerminalKinds.includes(kind)||!Number.isFinite(length)||length<1)return null;
  const angle=Math.atan2(dy,dx)*180/Math.PI,cx=(e.x+e.x2)/2,cy=(e.y+e.y2)/2;
  const scale=Math.min(1,length/44),half=18*scale;
  const voltage=['source','voltage-source','dependent-voltage-source'].includes(kind);
  const current=['current-source','dependent-current-source'].includes(kind);
  const diode=['diode','zener','schottky','led','photodiode'].includes(kind);
  const source=voltage||current||kind==='ac-source';
  const battery=kind==='battery'||kind==='cell';
  return <g data-symbol={kind}>
    <g transform={`translate(${cx} ${cy}) rotate(${angle})`}>
      <path data-part="leads" d={`M${-length/2} 0H${-half}M${half} 0H${length/2}`}/>
      <g transform={`scale(${scale})`} data-part="body">
        {source?<>
          {kind.startsWith('dependent-')?<path d="M-18 0L0 -22L18 0L0 22Z"/>:<circle r="18"/>}
          {current?<path data-part="current-direction" d="M-10 0H10" markerEnd={arrow}/>:null}
        </>:null}
        {battery?<>
          <path data-part="battery-plates" d={kind==='cell'?'M-18 0H-5M-5 -15V15M5 -8V8M5 0H18':'M-18 0H-12M-12 -15V15M-4 -8V8M4 -15V15M12 -8V8M12 0H18'}/>
        </>:null}
        {kind==='resistor'||kind==='variable-resistor'?<>
          <path d="M-18 0L-15 -7L-9 7L-3 -7L3 7L9 -7L15 7L18 0"/>
          {kind==='variable-resistor'?<path d="M-13 17L13 -17" markerEnd={arrow}/>:null}
        </>:null}
        {kind==='resistor-iec'?<rect x="-18" y="-7" width="36" height="14"/>:null}
        {kind==='capacitor'||kind==='polarized-capacitor'?<path d="M-18 0H-5M-5 -13V13M5 -13V13M5 0H18"/>:null}
        {kind==='inductor'?<path d="M-18 0a4.5 7 0 0 1 9 0a4.5 7 0 0 1 9 0a4.5 7 0 0 1 9 0a4.5 7 0 0 1 9 0"/>:null}
        {diode?<>
          <path data-part="diode-body" d="M-18 0H-9M-9 -10L9 0L-9 10ZM9 0H18"/>
          <path data-part="cathode" d={kind==='zener'?'M3 -15L9 -11V11L15 15':kind==='schottky'?'M3 -8V-13H9V13H15V8':'M9 -12V12'}/>
          {kind==='led'?<path data-part="light-out" d="M-8 -17L1 -26M3 -15L12 -24" markerEnd={arrow}/>:null}
          {kind==='photodiode'?<path data-part="light-in" d="M1 -26L-8 -17M12 -24L3 -15" markerEnd={arrow}/>:null}
        </>:null}
        {kind==='switch'||kind==='switch-closed'?<>
          <circle cx="-15" r="2.5"/><circle cx="15" r="2.5"/>
          <path d={`M-18 0H-17.5M17.5 0H18M-12.5 0L12.5 ${kind==='switch-closed'?0:-13}`}/>
        </>:null}
      </g>
    </g>
    {/* Source markings and polarity are always upright, including vertical/reversed branches. */}
    <g transform={`translate(${cx} ${cy}) scale(${scale})`} data-part="upright-markings">
      {kind==='ac-source'?<path data-part="ac-wave" d="M-11 0C-7 -13 -4 -13 0 0S7 13 11 0"/>:null}
      {voltage?<><Mark x={-dx/length*8} y={-dy/length*8}>+</Mark><Mark x={dx/length*8} y={dy/length*8}>−</Mark></>:null}
      {battery||kind==='polarized-capacitor'?<Mark x={-dx/length*12+dy/length*20} y={-dy/length*12-dx/length*20}>+</Mark>:null}
    </g>
  </g>;
}
