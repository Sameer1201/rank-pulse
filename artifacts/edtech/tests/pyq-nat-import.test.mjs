import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
import {moleConceptAnswers,moleConceptSource} from './fixtures/mole-concept-nat.mjs';
const window=new JSDOM('').window;
globalThis.DOMParser=window.DOMParser;globalThis.Node=window.Node;globalThis.NodeFilter=window.NodeFilter;
const built=await build({stdin:{contents:"export {parsePyqHtml} from './src/lib/pyqImport';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,format:'esm',platform:'node',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname});
const {parsePyqHtml}=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
const stem='4.5 g of compound A (MW = 90) was used to make 250 mL of its aqueous solution. The molarity in M is x × 10⁻¹. The value of x is ____ (nearest integer).';
const metadata='<meta name="exam" content="JAM Chemistry"><meta name="subject" content="Physical Chemistry">';
const embedded=(type,answer,options=[])=>metadata+`<script id="data" type="application/json">${JSON.stringify([{chapter:'Mole Concept',stem,question_type:type,answer,options,year:2020}])}</script>`;
const qcard=(type,answer)=>metadata+`<article class="q-card" data-type="${type}" data-chapter="Mole Concept" data-answer="${answer}"><div class="stem">${stem}</div><div class="answer-reveal">${answer}</div></article>`;
const questionCard=(type,answer)=>metadata+`<article class="question-card" data-type="${type}" data-chapter="Mole Concept"><div class="question-content">${stem}</div><div class="answer-correct">${answer}</div></article>`;
const edited=(answer,type='')=>metadata+`<article class="qcard" ${type?`data-type="${type}"`:''}><div class="qhead"><span class="qnum">1</span><div class="qtext">${stem}</div></div><div class="solution"><div class="answer">Answer: ${answer}</div><div class="solution-inner">Moles = 0.05; molarity = 0.2 M, so x = 2.</div></div></article>`;
for(const [name,source,min,max] of [
  ['embedded NAT without options',embedded('NAT','2'),2,2],
  ['embedded NAT discards stale option data',embedded('NAT','2',['stale A','stale B','stale C','stale D']),2,2],
  ['q-card numerical range',qcard('NAT','0.115–0.13'),0.115,0.13],
  ['question-card labelled numeric answer',questionCard('INTEGER','Answer: 2'),2,2],
  ['edited molarity question infers NAT from numeric key, not C',edited('2'),2,2],
  ['edited signed decimal range',edited('-0.13 to -0.115'),-0.13,-0.115],
  ['explicit NAT with zero',edited('0','NAT'),0,0],
  ['embedded scientific number',embedded('NAT','1e-3'),0.001,0.001],
])test(name,()=>{
  const q=parsePyqHtml(source,'nat.html').questions[0];
  assert.equal(q.questionType,'integer');assert.deepEqual(q.options,[]);assert.deepEqual(q.correctAnswers,[]);assert.equal(q.correctAnswer,null);
  assert.equal(q.answerMin,min);assert.equal(q.answerMax,max);assert.match(q.question,/4\.5 g/);
});
test('MCQ and MSQ answer-only imports retain letter controls, not NAT',()=>{
  for(const source of [embedded('MCQ','C'),qcard('MCQ','C'),questionCard('MCQ','C'),edited('C')]){
    const q=parsePyqHtml(source,'mcq.html').questions[0];assert.equal(q.questionType,'mcq');assert.equal(q.options.length,4);assert.equal(q.correctAnswer,2);
  }
  const multi=parsePyqHtml(embedded('MSQ','A,C'),'msq.html').questions[0];assert.equal(multi.questionType,'multi');assert.deepEqual(multi.correctAnswers,[0,2]);
});
test('explicit MCQ with real options keeps its numeric index answer',()=>{
  const q=parsePyqHtml(embedded('MCQ',2,['first','second','third','fourth']),'mcq.html').questions[0];assert.equal(q.questionType,'mcq');assert.equal(q.correctAnswer,2);assert.equal(q.options.length,4);
});
test('all 21 interactive Mole Concept questions keep numeric keys, never option C or student input',()=>{
  const questions=parsePyqHtml(moleConceptSource,'Mole_Concept_21Q_Interactive.html').questions;
  assert.equal(questions.length,21);
  questions.forEach((q,index)=>{
    assert.equal(q.questionType,'integer');assert.deepEqual(q.options,[]);assert.equal(q.correctAnswer,null);assert.deepEqual(q.correctAnswers,[]);
    assert.equal(q.answerText,String(moleConceptAnswers[index]));assert.equal(q.answerMin,moleConceptAnswers[index]);assert.equal(q.answerMax,moleConceptAnswers[index]);
    assert.match(q.explanation,/Worked numerical solution/);
  });
  assert.match(questions[0].question,/katex/,'math remains rendered');
});
test('published answer without data-answer still infers NAT',()=>{
  const q=parsePyqHtml(edited('2').replace('Answer: 2','✓ Published answer: 2'),'published.html').questions[0];
  assert.equal(q.questionType,'integer');assert.equal(q.answerText,'2');assert.equal(q.answerMin,2);assert.deepEqual(q.options,[]);
});
test('numeric input identifies NAT even when the official key is missing',()=>{
  const source=edited('').replace('<div class="solution">','<div class="numeric-line"><input class="num-answer" type="number" value="999"></div><div class="solution">');
  const q=parsePyqHtml(source,'missing-key.html').questions[0];
  assert.equal(q.questionType,'integer');assert.deepEqual(q.options,[]);assert.equal(q.answerMin,null);assert.equal(q.answerText,null);
});
test('explicit choice type remains authoritative over stale numeric UI',()=>{
  const source=edited('C','MCQ').replace('<div class="solution">','<div class="numeric-line"><input class="num-answer" type="number"></div><div class="solution">');
  const q=parsePyqHtml(source,'mcq.html').questions[0];assert.equal(q.questionType,'mcq');assert.equal(q.correctAnswer,2);
});
