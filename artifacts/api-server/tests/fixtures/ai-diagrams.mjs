const e=(kind,x,y,x2=x,y2=y,text,extra={})=>({kind,x,y,x2,y2,...(text?{text}:{}),...extra});
export const amplifier={version:2,kind:'circuit',title:'Common-emitter BJT amplifier',elements:[
  e('npn',300,180,300,180,'Q1'),e('voltage-source',440,60,440,300,'12 V'),
  e('wire',200,60,440,60),e('resistor',320,60,320,150,'R_C = 2 kΩ'),
  e('resistor',200,60,200,180,'R_1 = 100 kΩ'),e('resistor',200,180,200,300,'R_2 = 47 kΩ'),
  e('resistor',320,210,320,300,'R_E = 1 kΩ'),e('wire',200,180,270,180),
  e('wire',60,300,440,300),e('ground',320,300),e('capacitor',60,180,150,180,'C_in'),e('wire',150,180,200,180),
  e('ac-source',60,180,60,300,'v_in'),e('output',360,152,360,152,'v_out'),
]};
export const mosfet={...amplifier,title:'Common-source MOSFET amplifier',elements:amplifier.elements.map(el=>el.kind==='npn'?{...el,kind:'nmos',text:'M1'}:{...el,text:el.text?.replace('R_C','R_D').replace('R_E','R_S')})};
export const diode={version:2,kind:'circuit',title:'Diode circuit',elements:[e('voltage-source',60,60,60,240,'5 V'),e('resistor',60,60,280,60,'R = 1 kΩ'),e('diode',280,60,280,240,'D1'),e('wire',60,240,280,240),e('ground',60,240)]};
export const sfg={version:2,kind:'signal-flow',title:'Signal-flow graph',elements:[e('sfg-node',60,180,60,180,'R(s)'),e('sfg-node',220,180,220,180,'X(s)'),e('sfg-node',440,180,440,180,'Y(s)'),e('branch',60,180,220,180,'1'),e('branch',220,180,440,180,'G_1(s)'),e('branch',220,180,440,180,'G_2(s)',{bend:-140}),e('branch',440,180,220,180,'−H(s)',{bend:-140})]};
export const waveform={version:2,kind:'waveform',title:'Shifted rectangular pulse and discrete sample',elements:[
 e('axis',40,200,500,200,'t (ms)'),e('axis',90,260,90,45,'x(t) (V)'),
 e('plot',40,200,480,200,undefined,{points:[{x:40,y:200},{x:160,y:200},{x:160,y:90},{x:340,y:90},{x:340,y:200},{x:480,y:200}]}),
 e('label',65,90,65,90,'2'),e('label',155,225,155,225,'1'),e('label',335,225,335,225,'3'),e('impulse',420,200,420,255,'−1'),
]};
export const communication={version:2,kind:'control-system',title:'Coherent demodulator',elements:[
 e('input',20,120,20,120,'r(t)'),e('arrow',55,140,144,140),e('mixer',160,140,160,140,'Mixer'),e('arrow',176,140,280,140),
 e('block',280,105,380,175,'Low-pass filter'),e('arrow',380,140,490,140),e('output',495,144,495,144,'m(t)'),
 e('block',95,240,225,290,'Local oscillator'),e('arrow',160,240,160,156),
]};
export const diagrams={amplifier,mosfet,diode,sfg,waveform,communication};
