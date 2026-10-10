import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fixture } from './helpers/worker-fixture.mjs';

const generated = { question: 'A 12 V source is connected across a 4 ohm resistor. Find the current.', questionType: 'mcq', options: ['1 A', '2 A', '3 A', '4 A'], correctAnswer: 2, correctAnswerMulti: [], answerText: null, explanation: '$I=V/R=12/4=3$ A.', diagram: { kind: 'circuit', title: 'Resistor circuit', elements: [{kind:'source',x:35,y:35,x2:35,y2:145,text:'12 V'},{kind:'wire',x:35,y:35,x2:90,y2:35},{kind:'resistor',x:90,y:35,x2:260,y2:35,text:'4 Ω'},{kind:'wire',x:260,y:35,x2:260,y2:145},{kind:'wire',x:260,y:145,x2:35,y2:145}] } };
const seed = { source: 'pyq', sourceQuestionId: 7, exam: 'GATE ECE', subject: 'Networks', chapter: 'Circuits', question: 'Find the current through a resistor.', options: ['A', 'B'], questionType: 'mcq' };
const listPath = '/api/ai/similar-question?source=pyq&exam=GATE%20ECE&subject=Networks&chapter=Circuits';
function setup() {
  const f = fixture();
  f.sql.exec(`UPDATE users SET status='active', priority_access=1 WHERE id=2;
    INSERT INTO users (id, username, password_hash, full_name, email, role, status, priority_access) VALUES (3,'other','test','Other','other@example.test','student','active',1);`);
  f.env.AI_HINT_PYQ_URL = 'https://pyq.example.test';
  f.env.AI_HINT_PYQ_TOKEN = 'test-pyq-token';
  f.env.QB_PROXY_URL = 'https://qb.example.test';
  f.env.QB_PROXY_TOKEN = 'test-qb-token';
  return f;
}
async function withGateway(response, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, ...options, input: JSON.parse(options.body) });
    if (calls.at(-1).input.messages[0].content.startsWith('Independently')) {
      let value = response.response;
      if (typeof value === 'string') value = JSON.parse(value);
      return Response.json({response:{...value,valid:true,diagramValid:true,difficultyValid:true,reasoningSteps:3,reason:''}});
    }
    return Response.json(response);
  };
  try { await run(calls); } finally { globalThis.fetch = original; }
}

test('generation, owner-only list, bookmark, grading and persisted level-up work together', async () => {
  await withGateway({ response: JSON.stringify(generated) }, async (calls) => {
    const f = setup();
    const response = await f.request('/api/ai/similar-question', seed, { userId: 2 });
    assert.equal(response.status, 200);
    const { question } = await response.json();
    assert.equal(question.difficulty, 'easy');
    assert.equal(question.isSaved, false, 'generated questions must start unsaved');
    assert.match(calls[0].url, /pyq.example.test/);
    assert.match(calls[0].input.messages[0].content, /English/);
    const list = async (userId=2) => (await f.request(listPath, undefined, { userId, method: 'GET' })).json();
    assert.equal((await list()).questions.length, 0, 'unsaved generation must not appear below the chapter');
    const current = await (await f.request(listPath+'&view=current&sourceQuestionId=7', undefined, {userId:2,method:'GET'})).json();
    assert.equal(current.questions[0].id, question.id, 'refresh can recover an unsaved popup');
    assert.equal(current.questions[0].isSaved, false);
    assert.equal((await list(3)).questions.length, 0);
    const path = `/api/ai/similar-question/${question.id}`;
    for (const action of ['save', 'attempt']) assert.equal((await f.request(`${path}/${action}`, {answer:2}, {userId:3})).status, 404);
    assert.equal((await f.request(`${path}/save`, undefined, {userId:2})).status, 200);
    assert.equal((await list()).questions[0].isSaved, true);
    assert.equal((await (await f.request(`${path}/attempt`, {answer:0}, {userId:2})).json()).isCorrect, false);
    assert.equal((await list()).questions[0].solvedAt, null);
    assert.equal((await (await f.request(`${path}/attempt`, {answer:2}, {userId:2})).json()).isCorrect, true);
    const persisted = (await list()).questions[0];
    assert.ok(persisted.solvedAt);
    assert.equal(persisted.lastAnswer, 2);
    const saved = await f.request('/api/ai/similar-question?source=pyq&saved=1', undefined, {userId:2,method:'GET'});
    assert.equal((await saved.json()).questions[0].id, question.id);
    const wrongSubject = await f.request(listPath.replace('Networks','Analog'), undefined, {userId:2,method:'GET'});
    assert.equal((await wrongSubject.json()).questions.length, 0);
    const next = await f.request('/api/ai/similar-question', {...seed,difficulty:'mid'}, {userId:2});
    assert.equal((await next.json()).question.difficulty, 'mid');
    const qb = await f.request('/api/ai/similar-question', {...seed,source:'question-bank'}, {userId:2});
    assert.equal(qb.status, 200);
    assert.match(calls.at(-1).url, /qb.example.test/);
  });
});

test('authentication and eligibility fail before AI calls', async () => {
  await withGateway({response:generated}, async (calls) => {
    const f = setup();
    assert.equal((await f.request('/api/ai/similar-question',seed)).status, 401);
    f.sql.exec('UPDATE users SET priority_access=0 WHERE id=2');
    assert.equal((await f.request('/api/ai/similar-question',seed,{userId:2})).status,403);
    assert.equal(calls.length,0);
  });
});

test('PYQ and question-bank libraries show only explicit saves, including after attempts and level-up', async () => {
 await withGateway({response:generated},async()=>{
  for(const source of ['pyq','question-bank']){
   const f=setup();
   const listUrl=listPath.replace('source=pyq',`source=${source}`);
   const get=async(suffix='',userId=2)=>(await (await f.request(listUrl+suffix,undefined,{userId,method:'GET'})).json()).questions;
   const make=async(difficulty)=>(await (await f.request('/api/ai/similar-question',{...seed,source,difficulty},{userId:2})).json()).question;
   const easy=await make('easy');
   await f.request(`/api/ai/similar-question/${easy.id}/attempt`,{answer:2},{userId:2});
   assert.equal((await get()).length,0,'solving is not saving');
   await f.request(`/api/ai/similar-question/${easy.id}/save`,undefined,{userId:2});
   const mid=await make('mid');
   assert.deepEqual((await get()).map(q=>q.id),[easy.id],'level-up remains unsaved');
   assert.equal((await get('&view=current&sourceQuestionId=7'))[0].id,mid.id);
   assert.equal((await get('&view=current&sourceQuestionId=7',3)).length,0);
   assert.equal((await get('&saved=0')).length,1,'legacy library requests also hide drafts');
   await f.request(`/api/ai/similar-question/${easy.id}/save`,undefined,{userId:2});
   assert.equal((await get()).length,0,'unsaving removes the library entry');
  }
 });
});

test('NAT and MSQ are validated and graded, including zero and duplicate selections', async () => {
  for (const [question, answer, invalid] of [
    [{...generated,questionType:'integer',options:[],correctAnswer:null,answerText:'0'},'0',''],
    [{...generated,questionType:'multi',correctAnswer:null,correctAnswerMulti:[0,2]},[2,0],[0,0]],
  ]) await withGateway({response:question}, async () => {
    const f = setup();
    const r = await f.request('/api/ai/similar-question',{...seed,questionType:question.questionType},{userId:2});
    assert.equal(r.status,200);
    const id = (await r.json()).question.id;
    const result = await f.request(`/api/ai/similar-question/${id}/attempt`,{answer},{userId:2});
    assert.equal((await result.json()).isCorrect,true);
    assert.equal((await f.request(`/api/ai/similar-question/${id}/attempt`,{answer:invalid},{userId:2})).status,400);
  });
});

test('truncated output, missing solutions and invalid keys are never stored', async () => {
  const original = console.error;
  console.error = () => {};
  try {
    for (const value of ['{"question":', {...generated,correctAnswer:9}, {...generated,explanation:''}, {...generated,questionType:'integer',answerText:'abc'}]) {
      await withGateway({response:value}, async () => {
        const f = setup();
        const r = await f.request('/api/ai/similar-question',seed,{userId:2});
        assert.equal(r.status,503);
        assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ai_similar_questions').get().n,0);
      });
    }
  } finally { console.error = original; }
});

test('chapter library pagination retains more than 20 questions and separates exams', async () => {
  const f = setup();
  const insert = f.sql.prepare(`INSERT INTO ai_similar_questions (student_id,source,exam,subject,chapter,difficulty,question,options,is_saved) VALUES (2,'pyq',?,'Networks','Circuits','easy','Question','[]',1)`);
  for(let i=0;i<25;i++) insert.run('GATE ECE');
  insert.run('GATE EE');
  const first = await (await f.request(listPath,undefined,{userId:2,method:'GET'})).json();
  const second = await (await f.request(`${listPath}&before=${first.nextCursor}`,undefined,{userId:2,method:'GET'})).json();
  assert.equal(first.questions.length,20);
  assert.equal(second.questions.length,5);
  assert.equal(new Set([...first.questions,...second.questions].map(q=>q.id)).size,25);
});

test('an independent solver supplies the final options, key and solution for a fresh circuit', async () => {
  const original = globalThis.fetch;
  const f = setup();
  let calls = 0;
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(init.body); calls++;
    if (input.messages[0].content.startsWith('Independently')) {
      assert.equal(JSON.parse(input.messages[1].content).options, undefined);
      return Response.json({response:JSON.stringify({valid:true,diagramValid:true,difficultyValid:true,reasoningSteps:2,reason:'',options:['2 A','3 A','4 A','5 A'],correctOption:'3 A',correctOptions:[],answerText:null,explanation:'1. $R=3+5=8$ ohm.\\\\n2. $I=24/8=3$ A.'})});
    }
    return Response.json({response:{question:'A 24 V source drives series resistors of 3 and 5 ohm. Find the current.',questionType:'mcq',diagram:{layout:'series',voltage:24,resistances:[3,5]}}});
  };
  try {
    const r = await f.request('/api/ai/similar-question',seed,{userId:2});
    assert.equal(r.status,200);
    const q = (await r.json()).question;
    assert.equal(calls,2);
    assert.equal(q.correctAnswer,1);
    assert.match(q.explanation,/\n2\./);
    assert.equal(q.diagram.elements.filter(e=>e.kind==='resistor').length,2);
    assert.equal(q.diagram.elements.find(e=>e.kind==='source').text,'24 V');
  } finally { globalThis.fetch=original; }
});

test('organic practice uses molecule connectivity and rejects circuit-shaped diagrams', async () => {
  const original = globalThis.fetch;
  const f = setup();
  const molecule = { version:2, kind:'molecule', title:'Propene', atoms:[{id:'C1',element:'C'},{id:'C2',element:'C'},{id:'C3',element:'C'},{id:'H1',element:'H'}], bonds:[{from:'C1',to:'C2',order:2},{from:'C2',to:'C3',order:1},{from:'C3',to:'H1',order:1}] };
  globalThis.fetch = async (_url, init) => {
    const input = JSON.parse(init.body);
    if (input.messages[0].content.startsWith('Independently')) return Response.json({response:JSON.stringify({valid:true,diagramValid:true,difficultyValid:true,reasoningSteps:2,reason:'',options:['1','2','3','4'],correctOption:'2',correctOptions:[],answerText:null,explanation:'1. Count the double bond.\\n2. The compound is propene.'})});
    assert.match(input.messages[0].content,/kind="molecule"/);
    return Response.json({response:JSON.stringify({question:'Which compound contains a carbon-carbon double bond?',questionType:'mcq',visual:molecule})});
  };
  try {
    const response=await f.request('/api/ai/similar-question',{...seed,subject:'Organic Chemistry',chapter:'Alkenes',question:'Identify the alkene shown in the structure.',hasDiagram:true},{userId:2});
    assert.equal(response.status,200);
    const question=(await response.json()).question;
    assert.equal(question.diagram.kind,'molecule');
    assert.equal(question.diagram.elements.filter(e=>e.kind==='atom').length,4);
    assert.equal(question.diagram.elements.find(e=>e.kind==='bond'&&e.order===2).order,2);
  } finally { globalThis.fetch=original; }
});

test('copied reference questions are retried once and never stored', async () => {
  const log=console.error;console.error=()=>{};
  try { await withGateway({response:{...generated,question:seed.question}},async calls=>{
    const f=setup();
    const r=await f.request('/api/ai/similar-question',seed,{userId:2});
    assert.equal(r.status,503);assert.equal(calls.length,2);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ai_similar_questions').get().n,0);
  }); } finally {console.error=log;}
});

test('students can delete only their own generated practice question', async () => {
  await withGateway({ response: JSON.stringify(generated) }, async () => {
    const f = setup();
    const created = await (await f.request('/api/ai/similar-question', seed, { userId: 2 })).json();
    const id = created.question.id;
    assert.equal((await f.request(`/api/ai/similar-question/${id}`, undefined, { userId: 3, method: 'DELETE' })).status, 404);
    assert.equal((await f.request(`/api/ai/similar-question/${id}`, undefined, { userId: 2, method: 'DELETE' })).status, 200);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ai_similar_questions').get().n, 0);
  });
});

test('an amplifier cannot be stored with a resistor-only circuit', async () => {
  const source = {...seed,subject:'Analog Circuits',chapter:'BJT Analysis',question:'The common-emitter BJT amplifier shown has a voltage gain. Find its gain.',hasDiagram:true};
  const bad = {...generated,question:'For the common-emitter BJT amplifier shown, find the gain.',diagram:{kind:'circuit',title:'Amplifier',layout:'series',voltage:12,resistances:[1000,2000],elements:generated.diagram.elements}};
  const original = console.error; console.error = () => {};
  try {
    await withGateway({response:bad}, async calls => {
      const f=setup();
      const result=await f.request('/api/ai/similar-question',source,{userId:2});
      assert.equal(result.status,503);
      assert.equal(calls.length,2,'a failed visual is retried once');
      assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ai_similar_questions').get().n,0);
    });
  } finally { console.error=original; }
});

test('active circuit elements survive a stray passive layout field', async () => {
  const source = {...seed,subject:'Analog Circuits',chapter:'BJT Analysis',question:'A common-emitter BJT amplifier has a bias network, collector load, and an input signal. Find the gain.',hasDiagram:true};
  const visual = {version:2,kind:'circuit',title:'Common-emitter amplifier',layout:'series',voltage:12,resistances:[1000,2000],elements:[
    {kind:'transistor',x:300,y:180,x2:300,y2:180,text:'Q1'},
    {kind:'resistor',x:320,y:60,x2:320,y2:150,text:'R_C = 2 kΩ'},
    {kind:'resistor',x:120,y:60,x2:120,y2:180,text:'R_B = 100 kΩ'},
    {kind:'source',x:60,y:60,x2:60,y2:300,text:'12 V'},
    {kind:'wire',x:60,y:60,x2:320,y2:60},
    {kind:'wire',x:120,y:180,x2:270,y2:180},
    {kind:'wire',x:320,y:210,x2:320,y2:300},
    {kind:'wire',x:60,y:300,x2:320,y2:300},
    {kind:'ground',x:320,y:300,x2:320,y2:300},
    {kind:'input',x:180,y:165,x2:180,y2:165,text:'V_in'},
    {kind:'output',x:370,y:150,x2:370,y2:150,text:'V_out'},
  ]};
  await withGateway({response:{...generated,question:'For this common-emitter BJT amplifier, first find the bias current from 12 V and 1 kΩ, then find the gain using the 2 kΩ collector load.',diagram:visual}},async calls=>{
    const f=setup();
    const response=await f.request('/api/ai/similar-question',source,{userId:2});
    assert.equal(response.status,200);
    const result=(await response.json()).question;
    assert.equal(result.diagram.elements.filter(element=>element.kind==='transistor').length,1);
    assert.equal(result.diagram.elements.filter(element=>element.kind==='resistor').length,2);
    assert.equal(calls.length,2);
    assert.equal(JSON.parse(calls[1].input.messages[1].content).visual.elements.some(element=>element.kind==='transistor'),true);
  });
});

test('a claimed level-up rejected by the difficulty audit is not stored', async () => {
  const originalFetch=globalThis.fetch;
  const originalError=console.error;
  console.error=()=>{};
  let calls=0;
  globalThis.fetch=async (_url,init)=>{
    const request=JSON.parse(init.body); calls++;
    if (request.messages[0].content.startsWith('Independently')) return Response.json({response:{...generated,valid:true,diagramValid:true,difficultyValid:false,reason:'Only the resistor values changed.'}});
    return Response.json({response:generated});
  };
  try {
    const f=setup();
    const result=await f.request('/api/ai/similar-question',{...seed,difficulty:'hard',previousDifficulty:'mid'},{userId:2});
    assert.equal(result.status,503);
    assert.equal(calls,4);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ai_similar_questions').get().n,0);
  } finally { globalThis.fetch=originalFetch; console.error=originalError; }
});

test('Hard practice needs at least three dependent reasoning steps', async () => {
  const originalFetch=globalThis.fetch;
  const originalError=console.error;
  console.error=()=>{};
  let calls=0;
  globalThis.fetch=async (_url,init)=>{
    const request=JSON.parse(init.body); calls++;
    if (request.messages[0].content.startsWith('Independently')) return Response.json({response:{...generated,valid:true,diagramValid:true,difficultyValid:true,reasoningSteps:1,reason:''}});
    return Response.json({response:generated});
  };
  try {
    const f=setup();
    const result=await f.request('/api/ai/similar-question',{...seed,difficulty:'hard',previousDifficulty:'mid'},{userId:2});
    assert.equal(result.status,503);
    assert.equal(calls,4);
    assert.equal(f.sql.prepare('SELECT count(*) AS n FROM ai_similar_questions').get().n,0);
  } finally { globalThis.fetch=originalFetch; console.error=originalError; }
});

test('missing worked solution is repaired without regenerating the validated question', async () => {
  const originalFetch=globalThis.fetch, originalWarn=console.warn;
  console.warn=()=>{};
  let drafts=0, solves=0;
  globalThis.fetch=async (_url,init)=>{
    const input=JSON.parse(init.body);
    if (!input.messages[0].content.startsWith('Independently')) {drafts++;return Response.json({response:generated});}
    solves++;
    if(solves===2) {
      const context=JSON.parse(input.messages[1].content);
      assert.match(context.responseRepair,/MISSING_EXPLANATION/);
      assert.equal(context.question,generated.question);
    }
    return Response.json({response:{...generated,explanation:undefined,calculation:solves===1?'':'1. Apply Ohm\'s law.\n2. I = 12 / 4 = 3 A.',valid:true,diagramValid:true,difficultyValid:true,reasoningSteps:2}});
  };
  try {
    const f=setup();const response=await f.request('/api/ai/similar-question',seed,{userId:2});
    assert.equal(response.status,200);assert.equal(drafts,1);assert.equal(solves,2);
    assert.match((await response.json()).question.explanation,/3 A/);
  } finally {globalThis.fetch=originalFetch;console.warn=originalWarn;}
});

test('malformed solver JSON is retried and blank calculation does not hide an existing solution', async () => {
  const originalFetch=globalThis.fetch, originalWarn=console.warn;console.warn=()=>{};
  let solves=0;
  globalThis.fetch=async(_url,init)=>{
    const input=JSON.parse(init.body);
    if(!input.messages[0].content.startsWith('Independently'))return Response.json({response:generated});
    solves++;
    return Response.json({response:solves===1?'{"valid":':{...generated,calculation:'',valid:true,diagramValid:true,difficultyValid:true,reasoningSteps:2}});
  };
  try{const f=setup();const r=await f.request('/api/ai/similar-question',seed,{userId:2});assert.equal(r.status,200);assert.equal(solves,2);assert.match((await r.json()).question.explanation,/12\/4/);}
  finally{globalThis.fetch=originalFetch;console.warn=originalWarn;}
});
