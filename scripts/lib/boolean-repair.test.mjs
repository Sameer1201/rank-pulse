import assert from 'node:assert/strict';
import {test} from 'node:test';
import {booleanRepairPlan} from './boolean-repair.mjs';
const old='<math><mrow><mi>A</mi></mrow><mo>+</mo><mi>B</mi></math>';
const fixed='<math><mover><mi>A</mi><mo>¯</mo></mover><mo>+</mo><mi>B</mi></math>';
const row={question:old,options:JSON.stringify([old,'0']),explanation:old,correct_answer:0,question_type:'mcq',correct_answer_multi:'[]'};
const source={question:fixed,options:[fixed,'0'],explanation:fixed,correctAnswer:0,correctAnswers:[0]};
test('restores only missing bars and never changes answer keys',()=>{
 const plan=booleanRepairPlan(row,source);
 assert.deepEqual(plan.changedFields,['question','explanation','option A']);
 assert.deepEqual(Object.keys(plan.updates).sort(),['explanation','options','question']);
 assert.equal(booleanRepairPlan({...row,correct_answer:1},source),null);
 assert.equal(booleanRepairPlan({...row,question_type:'multi',correct_answer_multi:'[1]'},source),null);
});
test('rejects changed wording, changed option order and nonmatching diagrams',()=>{
 assert.equal(booleanRepairPlan({...row,question:old+'other'},source),null);
 assert.equal(booleanRepairPlan({...row,options:JSON.stringify(['0',old])},source),null);
 assert.equal(booleanRepairPlan({...row,question:old+'<img src="a.png">'},source),null);
});
test('no-op for already repaired content and preserve unrelated explanation edits',()=>{
 assert.deepEqual(booleanRepairPlan({...row,question:fixed,options:JSON.stringify(source.options),explanation:fixed},source).updates,{});
 assert.equal(booleanRepairPlan({...row,explanation:'Teacher edited solution'},source).updates.explanation,undefined);
});
test('repairs solution math without replacing previously cropped diagrams',()=>{
 const plan=booleanRepairPlan({...row,explanation:old+'<img src="admin-crop.png">'},{...source,explanation:fixed+'<img src="original.png">'});
 assert.match(plan.updates.explanation,/admin-crop\.png/);
 assert.doesNotMatch(plan.updates.explanation,/original\.png/);
 assert.match(plan.updates.explanation,/<mover>/);
 assert.deepEqual(plan.skippedFields,[]);
});
