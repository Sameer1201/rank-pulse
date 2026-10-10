import {JSDOM} from '../../artifacts/edtech/node_modules/jsdom/lib/api.js';
import {createHash} from 'node:crypto';
const window=new JSDOM('').window;
const bars=/^[¯ˉ‾̅―—]+$/;
const inspected=new Map();
export function inspectBooleanContent(html){
 if(inspected.has(html||''))return inspected.get(html||'');
 const doc=new window.DOMParser().parseFromString(html||'','text/html');
 // Choose one semantic representation, never concatenate KaTeX's hidden and
 // visual versions. Ignore no mathematical symbol except explicit overbars.
 for(const k of doc.querySelectorAll('.katex')){
   const math=k.querySelector('math');
   if(math)k.replaceWith(math.cloneNode(true));
 }
 doc.querySelectorAll('annotation,script,style').forEach(n=>n.remove());
 let count=0;
 for(const m of [...doc.querySelectorAll('mover')].reverse()){
   if(m.children.length===2 && bars.test(m.lastElementChild.textContent.trim())){
     count++;m.replaceWith(m.firstElementChild);
   }
 }
 count+=doc.querySelectorAll('.boolean-overline,.boolean-overbar').length;
 const text=doc.body.textContent.replace(/[\s\u200b]/g,'');
 const images=[...doc.querySelectorAll('img')].map(n=>n.getAttribute('src'));
 const svg=[...doc.querySelectorAll('svg')].map(n=>n.outerHTML);
 const result={bars:count,text,signature:createHash('sha256').update(JSON.stringify({text,images,svg})).digest('hex')};
 inspected.set(html||'',result);
 return result;
}

/** Repair math only when diagrams differ (for example an admin recropped an
 * image). Preserve every existing diagram, caption and non-math node. */
function restoreMatchingMath(oldHtml,sourceHtml){
 if(inspectBooleanContent(oldHtml).text!==inspectBooleanContent(sourceHtml).text)return null;
 const parse=html=>new window.DOMParser().parseFromString(html||'','text/html');
 const old=parse(oldHtml),source=parse(sourceHtml);
 const formulas=doc=>[...doc.querySelectorAll('.katex, math')].filter(node=>node.matches('.katex')||!node.closest('.katex'));
 const before=formulas(old),after=formulas(source);
 if(before.length!==after.length)return null;
 for(let i=0;i<before.length;i++){
   if(inspectBooleanContent(before[i].outerHTML).signature!==inspectBooleanContent(after[i].outerHTML).signature)return null;
 }
 let changed=false;
 for(let i=0;i<before.length;i++){
   if(inspectBooleanContent(after[i].outerHTML).bars>inspectBooleanContent(before[i].outerHTML).bars){
     before[i].replaceWith(after[i].cloneNode(true));changed=true;
   }
 }
 return changed?old.body.innerHTML:null;
}

export function booleanRepairPlan(row,source){
 const options=JSON.parse(row.options);
 if(!Array.isArray(options)||options.length!==source.options.length)return null;
 if(row.correct_answer!==source.correctAnswer)return null;
 const oldMulti=JSON.parse(row.correct_answer_multi||'[]');
 if(row.question_type==='multi'&&JSON.stringify(oldMulti)!==JSON.stringify(source.correctAnswers))return null;
 const signature=value=>inspectBooleanContent(value).signature;
 if(signature(row.question)!==signature(source.question))return null;
 if(options.some((value,i)=>signature(value)!==signature(source.options[i])))return null;
 const updates={};
 const changedFields=[];
 const skippedFields=[];
 const oldFields={question:row.question,explanation:row.explanation};
 for(const field of ['question','explanation']){
   const before=inspectBooleanContent(oldFields[field]);
   const after=inspectBooleanContent(source[field]);
   if(after.bars>before.bars && before.signature===after.signature){
     updates[field]=source[field];changedFields.push(field);
   }
   if(after.bars>before.bars && before.signature!==after.signature){
     const restored=restoreMatchingMath(oldFields[field],source[field]);
     if(restored){updates[field]=restored;changedFields.push(field);}
     else skippedFields.push(field);
   }
 }
 const restoredOptions=options.map((old,i)=>{
   const before=inspectBooleanContent(old),after=inspectBooleanContent(source.options[i]);
   if(after.bars>before.bars){changedFields.push(`option ${'ABCD'[i]??i}`);return source.options[i];}
   return old;
 });
 if(changedFields.some(f=>f.startsWith('option ')))updates.options=JSON.stringify(restoredOptions);
 return {updates,changedFields,skippedFields};
}
