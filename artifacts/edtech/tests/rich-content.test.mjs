import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import katex from 'katex';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';
const window = new JSDOM('').window;
globalThis.DOMParser = window.DOMParser;
globalThis.Node = window.Node;
globalThis.NodeFilter = window.NodeFilter;
const bundled = await build({stdin:{contents:`export * from './src/lib/richContent'; export * from './src/lib/pyqImport'; export * from './src/lib/pyqContent';`,resolveDir:new URL('..',import.meta.url).pathname}, bundle:true, write:false, format:'esm',platform:'node',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname});
const {sanitizeRichHtml, plainTextWithMath, parsePyqHtml, stripRepeatedPyqOptions, getPyqDisplayOptions, stripRichHtmlToText} = await import('data:text/javascript;base64,'+Buffer.from(bundled.outputFiles[0].text).toString('base64'));
const math = katex.renderToString(String.raw`I_E=\frac{V_E}{1k\Omega}=\frac{3}{1000},\quad V_i(t)=10^5t+10^7t`,{output:'html'});
const doc = html => new DOMParser().parseFromString(html,'text/html');
const subjectFile = (question, options, solution) => `<meta name="subject" content="Maths"><meta name="exam" content="GATE ECE"><section class="chapter"><h2>Equations</h2><article class="question-card" data-type="MCQ" data-year="2026"><div class="question-content">${question}<table class="answer_table">${options.map((o,i)=>`<tr class="${i===1?'pp-correct-option':''}"><td class="answer_col"><span class="pp-option-letter">${String.fromCharCode(65+i)}.</span><div class="option_data">${o}</div></td></tr>`).join('')}</table></div><div class="solution-content">${solution}</div></article></section>`;

test('Boolean CSS bars survive import in questions, options and solutions, without source CSS', () => {
 const expression='<span class="complement"><span style="text-decoration: overline">A</span> + B</span> &oplus; C';
 const source='<style>.complement { text-decoration: overline; background: url(https://untrusted.test); }</style>' + subjectFile(expression,[expression,'0'],expression);
 const q=parsePyqHtml(source,'boolean.html').questions[0];
 for(const field of [q.question,q.options[0],q.explanation]) {
   assert.equal(doc(field).querySelectorAll('.boolean-overline').length,2);
   assert.equal(sanitizeRichHtml(field),field);
   assert.doesNotMatch(field,/background|untrusted|<style/);
   assert.match(stripRichHtmlToText(field),/¬\(A̅ \+ B\) ⊕ C/);
 }
});

test('bare and delimited Boolean TeX preserve nested whole bars, single bars and XOR', () => {
 for(const expression of [String.raw`\overline{\bar{A}+B} \oplus C`, String.raw`$\overline{\bar{A}+B} \oplus C$`]) {
   const q=parsePyqHtml(subjectFile(expression,[expression,'0'],expression),'boolean.html').questions[0];
   for(const field of [q.question,q.options[0],q.explanation,sanitizeRichHtml(plainTextWithMath(expression))]) {
     assert(doc(field).querySelector('.katex'));
     assert(doc(field).querySelector('mover mover'));
     assert.match(stripRichHtmlToText(field),/¬\(A̅\+B\)\s*⊕\s*C/);
     assert.equal(sanitizeRichHtml(field),field);
   }
 }
 assert.match(stripRichHtmlToText(sanitizeRichHtml(plainTextWithMath(String.raw`A \oplus B`))),/A ⊕ B/);
});

test('native MathML overbars and XOR remain intact', () => {
 const source='<math><mrow><mover accent="true"><mrow><mi>A</mi><mo>+</mo><mi>B</mi></mrow><mo>¯</mo></mover><mo>⊕</mo><mi>C</mi></mrow></math>';
 const html=sanitizeRichHtml(source);
 assert(doc(html).querySelector('mover[accent="true"]'));
 assert.equal(stripRichHtmlToText(html),'¬(A+B)⊕C');
});

test('offline math-shell source uses authoritative TeX, not its CSS-only MathML fallback', () => {
 const shell=(tex, display=false)=>`<span class="math-shell" data-tex="${tex}"><math${display?' display="block"':''}><mrow><mi>A</mi><mi>B</mi></mrow></math></span>`;
 const stem=String.raw`F=(A+\overline{B})(\overline{C}+D)(\overline{B}+C)`;
 const options=[String.raw`\overline{A}B+C\overline{D}+B\overline{C}`,String.raw`A\overline{B}+\overline{C}D+\overline{B}C`,String.raw`A\overline{B}+C\overline{D}+BC`,'AB+BC+CD'];
 const source=`<article class="qcard" data-answer="A" data-q="23"><div class="qhead"><div class="qtext">The complement of ${shell(stem,true)} is</div></div><div class="opts">${options.map((tex,i)=>`<button class="opt" data-choice="${'ABCD'[i]}"><b>${'ABCD'[i]}</b><span class="option-content">${shell(tex)}</span></button>`).join('')}</div><details class="solution"><div class="worked">${shell(options[0])}</div></details></article>`;
 const q=parsePyqHtml(source,'overbars.html').questions[0];
 assert.equal(doc(q.question).querySelector('annotation').textContent,stem);
 assert(doc(q.question).querySelector('.katex-display'));
 assert.equal(doc(q.question).querySelectorAll('.overline-line').length,3);
 assert.deepEqual(q.options.map(option=>doc(option).querySelectorAll('.overline-line').length),[3,3,2,0]);
 assert.equal(new Set(q.options.map(stripRichHtmlToText)).size,4);
 // This minimal fixture omits the separate published-answer element.
 assert.equal(sanitizeRichHtml(q.question),q.question);
});

test('saved native horizontal-bar MathML and runtime CSS mrows retain explicit accents', () => {
 const legacy='<math><mover><mi>B</mi><mo accent="true">―</mo></mover></math>';
 const runtime='<math><mrow class="boolean-overbar"><mi>A</mi><mo>+</mo><mrow class="boolean-overbar"><mi>B</mi></mrow></mrow></math>';
 const fixed=sanitizeRichHtml(legacy);
 assert(doc(fixed).querySelector('mover[accent="true"] mo[stretchy="true"]'));
 assert.equal(doc(fixed).querySelector('mo').textContent,'¯');
 assert.equal(sanitizeRichHtml(fixed),fixed);
 const nested=sanitizeRichHtml(runtime);
 assert.equal(doc(nested).querySelectorAll('mover').length,2);
 assert.equal(stripRichHtmlToText(nested),'¬(A+B̅)');
});

test('complex imported math remains identical through saving and repeated rendering',()=>{
 const equations = [String.raw`\frac{1}{\sqrt{T_1T_2}}`, String.raw`\tan^{-1}\left(\frac{\omega T_1+\omega T_2}{1-\omega^2T_1T_2}\right)`, String.raw`x_i^2+X^3+10^{-5}+s_1`, String.raw`\sqrt[3]{\frac{a^2+b^2}{c_0}}`, String.raw`\int_0^\infty e^{-st}\,dt`, String.raw`\sum_{n=0}^{\infty}\frac{x^n}{n!}`, String.raw`\begin{bmatrix}a&b\\c&d\end{bmatrix}`, String.raw`\begin{aligned}x&=\frac{1}{2}\\y&=\sqrt{x}\end{aligned}`,String.raw`\overline{AB}+\hat{x}+\vec{v}`, String.raw`\begin{array}{c|c}a&b\\\hline c&d\end{array}`, String.raw`f(x)=\begin{cases}x^2&x>0\\-x&x\le0\end{cases}`, String.raw`\underbrace{x+\dots+x}_{n}+\binom{n}{k}`, String.raw`\lim_{x\to0}\frac{\sin x}{x}`, String.raw`\overrightarrow{AB}+\underline{y}`];
 const visual = (html) => [...doc(html).querySelectorAll('.katex')].map(k=>[...k.querySelectorAll('*')].map(n=>({tag:n.tagName,classes:[...n.classList].sort(),style:Array.from(n.style||[]).sort().map(p=>[p,n.style.getPropertyValue(p)]),d:n.getAttribute('d'),text:n.children.length?null:n.textContent})));
 for(const tex of equations){
  const source=katex.renderToString(tex,{output:'html'});
  const imported=parsePyqHtml(subjectFile(`<div class="question_text">${source}</div>`,[source,source],source),'math.html').questions[0];
  for(const field of [imported.question,...imported.options,imported.explanation]){
   assert.deepEqual(visual(field),visual(source),tex);
   assert.equal(sanitizeRichHtml(sanitizeRichHtml(field)),field,tex+' re-render');
  }
  assert.equal(imported.correctAnswer,1);
  assert.equal(doc(imported.question).querySelectorAll('table').length,0);
 }
});

test('import preserves all sibling figures, semantic scripts and image-only answer choices',()=>{
 const figure='<img src="data:image/png;base64,YQ==">';
 const q=parsePyqHtml(subjectFile(`<div class="question_text">x<sub>1</sub> + X<sup>2</sup> ${figure}</div><div>${figure}${figure}</div>`,[figure,'<span style="vertical-align: super">3</span>'],`<math><mfrac><msqrt><mi>x</mi></msqrt><msubsup><mi>T</mi><mn>1</mn><mn>2</mn></msubsup></mfrac></math>`),'figures.html').questions[0];
 assert.equal(doc(q.question).querySelectorAll('img').length,3);
 assert.equal(doc(q.options[0]).querySelectorAll('img').length,1);
 assert.equal(doc(q.options[1]).querySelector('sup').textContent,'3');
 assert(doc(q.explanation).querySelector('math mfrac msqrt'));
 assert.equal(q.imageData,null);
 assert.equal(q.chapter,'Equations');
});

test('import typesets delimited TeX and math scripts and rejects invalid TeX',()=>{
 const q=parsePyqHtml(subjectFile(String.raw`<div class="question_text">Find \(x_1^2\).</div>`,[String.raw`$\sqrt{x}$`,'1'],String.raw`<script type="math/tex; mode=display">\frac{1}{\sqrt{x}}</script>`),'tex.html').questions[0];
 for(const field of [q.question,q.options[0],q.explanation])assert(doc(field).querySelector('.katex'));
 assert(!doc(q.explanation).querySelector('script'));
 assert.throws(()=>parsePyqHtml(subjectFile(String.raw`\(\notARealCommand{x}\)`,['1','2'],'Solution'),'bad.html'));
});

test('pre-rendered KaTeX retains all fraction, subscript, superscript layout and empty struts after repeated sanitizing',()=>{
 const result=sanitizeRichHtml(math);
 const source=doc(math), output=doc(result);
 for(const selector of ['.katex','.msupsub','.mfrac','.frac-line','.strut','.pstrut','.vlist']) {
  assert.equal(output.querySelectorAll(selector).length,source.querySelectorAll(selector).length,selector);
 }
 assert.deepEqual([...output.querySelectorAll('[style]')].map(x=>x.style.cssText),[...source.querySelectorAll('[style]')].map(x=>x.style.cssText));
 assert.equal(sanitizeRichHtml(result),result);
});
test('untrusted markup is sanitized even through unknown wrappers and math classes',()=>{
 const result=sanitizeRichHtml('<custom><img src="javascript:evil()" onerror="bad()"><script>bad()</script><span class="katex fixed" style="position:fixed;background:url(https://evil);height:1em" onclick="bad()">x</span></custom>');
 assert(!/javascript|onerror|onclick|script|position|background|fixed/.test(result));
 assert(result.includes('height: 1em'));
});
test('nested TeX fractions use real KaTeX',()=>{
 const result=sanitizeRichHtml(plainTextWithMath(String.raw`Current: $I_B=\frac{\frac{3}{1000}}{100}$`));
 assert.equal(doc(result).querySelectorAll('.mfrac').length,2);
 assert(result.startsWith('Current: '));
});
test('legacy nested span math restores subscripts and fractions without reimporting',()=>{
 const legacy='<span><span>G</span><span><span><span>1</span><span>\u200b</span></span></span></span><span>(s)=</span><span><span><span>1+G(s)+G(s)H(s)</span><span>G(s)</span></span></span>';
 const result=sanitizeRichHtml(legacy);
 assert.equal(doc(result).querySelector('sub')?.textContent,'1');
 assert.equal(doc(result).querySelectorAll('.math-frac').length,1);
});
test('legacy zero-width markers keep powers as superscripts',()=>{
 const result=sanitizeRichHtml('<span><span>x</span><span><span>3</span><span>\u200b</span></span></span>');
 assert.equal(doc(result).querySelector('sup')?.textContent,'3');
});
test('legacy inverse-function spans restore a real superscript',()=>{
 const result=sanitizeRichHtml('<span><span>tan</span><span><span>−1</span></span></span>');
 assert.equal(doc(result).querySelector('sup')?.textContent,'−1');
});
test('loose source option labels are removed from the question body',()=>{
 const result=stripRepeatedPyqOptions('<div>Which graph is correct?</div><img src="data:image/png;base64,YQ=="><div>A. A B. B C. C D. D</div>', ['A','B','C','D']);
 assert(!/A\.\s*A\s+B\.\s*B/.test(result));
 assert(doc(result).querySelector('img'));
});
test('import and duplicate option removal preserve math and embedded images',()=>{
 const choices=['A','B'].map(x=>`<tr><td class="option_data">${x}${math}</td></tr>`).join('');
 const html=`<title>Analog — GATE ECE</title><section class="chapter"><h2>Chapter</h2><article class="question-card" data-year="2026"><div class="question-content"><div class="question_text">${math}<img src="data:image/png;base64,YQ=="></div><table class="answer_table">${choices}</table></div><div class="solution-content">${math}</div></article></section>`;
 const q=parsePyqHtml(html,'test.html').questions[0];
 assert.equal(q.imageData,null);
 assert(doc(q.question).querySelector('img'));
 assert(doc(q.explanation).querySelector('.mfrac'));
 assert(doc(q.options[0]).querySelector('.msupsub'));
 const rendered=stripRepeatedPyqOptions(q.question+`<table>${choices}</table>`,q.options);
 assert(doc(rendered).querySelector('.mfrac'));
 assert.equal(doc(rendered).querySelectorAll('table').length,0);
});
test('display options recover the source KaTeX answer rows from legacy question HTML',()=>{
 const source = ['A','B'].map((label) => `<tr><td><span class="pp-option-letter">${label}.</span><div class="option_data">${math}</div></td></tr>`).join('');
 const recovered = getPyqDisplayOptions(`<div>Question</div><table class="answer_table">${source}</table>`, ['flattened A', 'flattened B']);
 assert.equal(recovered.length, 2);
 assert(doc(recovered[0]).querySelector('.katex'));
 assert(doc(recovered[0]).querySelector('.mfrac'));
});
test('malformed legacy answer rows are removed from the question body',()=>{
 const source = ['A','B'].map((label) => `<span class="pp-option-letter">${label}. </span><div class="option_data">${math}</div>`).join('');
 const cleaned = stripRepeatedPyqOptions(`<div>Question?</div>${source}`, ['flattened A', 'flattened B']);
 const output = doc(cleaned);
 assert.equal(output.querySelectorAll('.option_data').length, 0);
 assert.equal(output.querySelectorAll('.pp-option-letter').length, 0);
});
