import assert from 'node:assert/strict';
import {test} from 'node:test';
import {JSDOM} from 'jsdom';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';
const window=new JSDOM('').window;globalThis.DOMParser=window.DOMParser;
const bundle=await build({stdin:{contents:"export * from './src/lib/practice-question-content';",resolveDir:new URL('..',import.meta.url).pathname},bundle:true,write:false,platform:'node',format:'esm',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname});
const {reflowPracticeQuestion}=await import('data:text/javascript;base64,'+Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const lines=['The longest wavelength that can be absorbed by silicon, which has the bandgap','of 1.12 eV, is 1.1 μm. If the longest wavelength that can be absorbed by','another material is 0.87 μm, then bandgap of this material is'];
const doc=html=>new DOMParser().parseFromString(html,'text/html');
test('source-width line wraps reflow for plain text, BRs and split prose paragraphs',()=>{
  assert.equal(reflowPracticeQuestion(lines.join('\n')),lines.join(' '));
  for(const html of [`<p>${lines.join('<br>')}</p>`,lines.map(line=>`<p>${line}</p>`).join('')]){
    const result=doc(reflowPracticeQuestion(html));assert.equal(result.querySelectorAll('p').length,1);assert.equal(result.querySelectorAll('br').length,0);assert.equal(result.body.textContent,lines.join(' '));
  }
});
test('semantic paragraphs, lists, equations, tables, figures and math are not flattened',()=>{
  const content=lines[0]+'\n\nx = 5\nThe question asks:\na) First choice\nb) Second choice';assert.equal(reflowPracticeQuestion(content),content);
  assert.equal(reflowPracticeQuestion(lines[0]+'\nx = 5'),lines[0]+'\nx = 5');
  assert.equal(reflowPracticeQuestion(lines[0]+'\nb) Second choice'),lines[0]+'\nb) Second choice');
  const source=`<p>First standalone sentence.</p><p>Second paragraph.</p><table><tr><td>${lines[0]}<br>${lines[1]}</td></tr></table><ul><li>${lines[0]}<br>${lines[1]}</li></ul><div class="katex-display"><span>${lines[0]}<br>${lines[1]}</span></div><figure><img src="diagram.png"><br>Figure caption</figure>`;
  assert.equal(doc(reflowPracticeQuestion(source)).querySelectorAll('br').length,4);
  assert.equal(doc(reflowPracticeQuestion(source)).querySelectorAll('p').length,2);
});
test('empty imported spacer blocks disappear, inline formula markup and data stay intact',()=>{
  const source=`<div><p><br><br></p><p>${lines[0]}<br>of 1.12 eV, is <span class="katex"><math><mi>μ</mi></math></span>m.</p><div><br></div></div>`;
  const result=doc(reflowPracticeQuestion(source));assert.equal(result.querySelectorAll('br').length,0);assert(result.querySelector('.katex math mi'));assert.equal(result.querySelectorAll('p').length,1);assert.equal(result.querySelectorAll('div').length,1);
  assert.equal(reflowPracticeQuestion(reflowPracticeQuestion(source)),reflowPracticeQuestion(source));
});
