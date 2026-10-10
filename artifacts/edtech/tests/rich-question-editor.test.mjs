import assert from 'node:assert/strict';
import {test} from 'node:test';
import {createRequire} from 'node:module';
import {JSDOM} from 'jsdom';
import {build} from '../../api-server/node_modules/esbuild/lib/main.js';

const dom=new JSDOM('<!doctype html>');
for(const key of ['document','DOMParser','Node','HTMLElement'])globalThis[key]=dom.window[key];
const bundled=await build({entryPoints:[new URL('../src/lib/rich-question-editor.ts',import.meta.url).pathname],bundle:true,write:false,format:'cjs',platform:'node',tsconfig:new URL('../tsconfig.json',import.meta.url).pathname});
const module={exports:{}};new Function('require','module','exports',bundled.outputFiles[0].text)(createRequire(import.meta.url),module,module.exports);
const {richEditorHtml,protectEditorMath,serializeRichEditor}=module.exports;
const rootFor=value=>{const root=document.createElement('div');root.innerHTML=richEditorHtml(value);return root;};

test('imported HTML is visual, preserving images, scripts, Boolean bars and tables on save',()=>{
 const root=rootFor('<p>A silicon sample at 10<sup>16</sup> cm<sup>−3</sup>, <em>W</em> = 10<sup>−2</sup>.</p><p><img src="data:image/png;base64,YQ==" alt="Circuit"></p><p><span style="text-decoration:overline">AB</span> ⊕ C</p><table><tr><td>x<sub>1</sub></td></tr></table>');
 assert.equal(root.querySelector('sup').textContent,'16');assert.equal(root.querySelector('em').textContent,'W');
 assert.equal(root.querySelector('img').getAttribute('src'),'data:image/png;base64,YQ==');
 assert.equal(root.querySelector('.boolean-overline').textContent,'AB');
 assert.ok(root.querySelector('table sub'));
 root.querySelector('img').setAttribute('data-editor-selected','true');
 const saved=serializeRichEditor(root);const reloaded=rootFor(saved);
 assert.equal(reloaded.querySelector('img').getAttribute('src'),'data:image/png;base64,YQ==');
 assert.ok(reloaded.querySelector('.boolean-overline'));assert.doesNotMatch(saved,/data-editor-selected|contenteditable/);
});

test('plain and HTML-delimited formulas render and round-trip without flattening bars/fractions',()=>{
 for(const value of ['Field $\\overline{A+B} \\oplus C$ at $\\frac{1}{2}$','<p>Field $\\overline{A+B} \\oplus C$ at $\\frac{1}{2}$</p>']){
  const root=rootFor(value);assert.equal(root.querySelectorAll('.katex').length,2);assert.doesNotMatch(root.textContent,/\$/);
  protectEditorMath(root);assert.equal(root.querySelector('.katex').contentEditable,'false');
  const saved=serializeRichEditor(root);assert.doesNotMatch(saved,/contenteditable/);
  const again=rootFor(saved);assert.equal(again.querySelectorAll('.katex').length,2);
  assert.equal(again.querySelector('annotation').textContent,'\\overline{A+B} \\oplus C');
  assert.ok(again.querySelector('.overline-line'));assert.ok(again.querySelector('.frac-line'));
 }
});

test('unsafe pasted/imported markup is removed while valid content remains',()=>{
 const root=rootFor('<p onclick="evil()">Safe<sup>2</sup></p><script>alert(1)</script><iframe src="https://evil.test"></iframe><img src="javascript:alert(1)" onerror="evil()"><img src="/good.png" onerror="evil()">');
 assert.equal(root.querySelector('sup').textContent,'2');assert.equal(root.querySelectorAll('script,iframe,[onclick],[onerror]').length,0);
 assert.ok([...root.querySelectorAll('img')].every(img=>!img.getAttribute('src')?.startsWith('javascript:')));
 assert.equal(root.querySelector('img[src="/good.png"]').getAttribute('src'),'/good.png');
});

test('empty browser paragraphs stay empty but image-only content is retained',()=>{
 const root=document.createElement('div');root.innerHTML='<div><br></div>';
 assert.equal(serializeRichEditor(root),'');root.innerHTML='<img src="/diagram.png">';assert.match(serializeRichEditor(root),/diagram.png/);
});
