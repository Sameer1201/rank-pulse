import type { D1Database } from '@cloudflare/workers-types';
import manifest from './starter-manifest.json';

type Row = Record<string, any>;
type Value = string | number | boolean | null;
type Statement = { sql: string; params: Value[] };
export type BankDatabase = {
  prepare(sql: string): { bind(...params: unknown[]): { all<T>(): Promise<{results:T[]}>; first<T>(): Promise<T|null>; run(): Promise<{success:boolean;meta?:Record<string,unknown>}> } };
  batch?(statements: Statement[]): Promise<void>;
};
const NEW_ID = 4_000_000_000_000;
const ids = new Set(manifest.questions);
export const isStarterQuestion = (id: unknown) => Number(id)>NEW_ID || ids.has(Number(id));
const keys: Record<string,keyof typeof manifest> = {question_bank_questions:'questions',question_bank_question_progress:'progress',question_bank_saved_questions:'saved',question_bank_reports:'reports',test_question_bank_links:'links'};
const mainTables=new Set(['student_question_timers','student_daily_question_activity','student_daily_activity_totals']);
const tableOf=(sql:string)=>{
 const word=outerWords(sql).find(w=>['FROM','INTO','UPDATE'].includes(w.word));
 return word?sql.slice(word.at+word.word.length).match(/^\s+["`]?([\w]+)["`]?/)?.[1].toLowerCase()??'':'';
};
function selectExpressions(select:string) {
 let depth=0,start=0;const parts:string[]=[];
 for(let i=0;i<select.length;i++){if(select[i]==='(')depth++;if(select[i]===')')depth--;if(select[i]===','&&depth===0){parts.push(select.slice(start,i));start=i+1;}}
 return [...parts,select.slice(start)];
}

/** Locate outer clauses only: subquery WHERE/LIMIT and quoted words aren't outer clauses. */
function outerWords(sql:string) {
  let depth=0,quote='';const words:{word:string;at:number}[]=[];
  for(let i=0;i<sql.length;i++){
    const c=sql[i];
    if(quote){if(c===quote){if(sql[i+1]===quote)i++;else quote='';}continue;}
    if(/["'`]/.test(c)){quote=c;continue;}
    if(c==='('){depth++;continue;}if(c===')'){depth--;continue;}
    if(depth===0&&/[a-z_]/i.test(c)){const at=i;while(i+1<sql.length&&/[\w]/.test(sql[i+1]))i++;words.push({word:sql.slice(at,i+1).toUpperCase(),at});}
  }
  return words;
}
export function addOuterPredicate(sql:string,predicate:string) {
  const words=outerWords(sql),where=words.find(w=>w.word==='WHERE');
  const end=words.find(w=>['GROUP','ORDER','LIMIT','OFFSET','RETURNING'].includes(w.word)&&(!where||w.at>where.at))?.at??sql.length;
  if(where)return `${sql.slice(0,where.at)} WHERE (${sql.slice(where.at+5,end).trim()}) AND (${predicate}) ${sql.slice(end)}`;
  return `${sql.slice(0,end)} WHERE (${predicate}) ${sql.slice(end)}`;
}
const paramAt=(sql:string,at:number,params:unknown[])=>params[(sql.slice(0,at).match(/\?/g)??[]).length];
function equalParam(sql:string,column:string,params:unknown[]) {
 const m=new RegExp(`\\b(?:[a-z_]+\\.)?${column}\\s*=\\s*\\?`,'i').exec(sql);
 return m?paramAt(sql,m.index+m[0].lastIndexOf('?'),params):undefined;
}
function insertParam(sql:string,column:string,params:unknown[]) {
 const m=/\bINSERT(?:\s+OR\s+\w+)?\s+INTO\s+["`]?\w+["`]?\s*\(([^)]+)\)\s*(VALUES\s*\(([^)]*)\)|SELECT\s+([\s\S]*?)\s+WHERE)/i.exec(sql);
 if(!m)return undefined;
 const columns=m[1].split(',').map(v=>v.trim().replace(/["`]/g,'')),i=columns.indexOf(column);
 if(i<0)return undefined;const values=(m[3]??m[4]).split(',');
 const expression=values[i]?.trim();if(expression==='?')return params[values.slice(0,i).join(',').split('?').length-1];
 if(expression?.startsWith("'"))return expression.slice(1,-1);return undefined;
}
function selectedQuestion(sql:string,params:unknown[],table:string) {
 const column=table==='question_bank_questions'?'id':table==='test_question_bank_links'?'question_bank_question_id':'question_id';
 return /^\s*INSERT/i.test(sql)?insertParam(sql,column,params):equalParam(sql,column,params);
}
function questionBatch(sql:string,params:unknown[],table:string):number[]|null {
 const column=table==='question_bank_questions'?'id':table==='test_question_bank_links'?'question_bank_question_id':'question_id';
 const m=new RegExp(`\\b${column}\\s+IN\\s*\\(\\s*SELECT\\s+value\\s+FROM\\s+json_each\\(\\?\\)\\s*\\)`,'i').exec(sql);
 if(!m)return null;
 try{const values=JSON.parse(String(paramAt(sql,m.index+m[0].indexOf('?'),params)));return Array.isArray(values)&&values.length?values.map(Number):null;}catch{return null;}
}
function sourcePredicate(table:string) {
 const key=table==='question_bank_questions'?'id':table==='test_question_bank_links'?'question_bank_question_id':'question_id';
 return `${table}.${key} NOT IN (${manifest.questions.join(',')||'-1'}) AND ${table}.${key} <= ${NEW_ID}`;
}

export function mergeStarterRows(sql:string,left:Row[],right:Row[]):Row[] {
 const rows=[...left,...right];
 const aggregate=/\b(COUNT|SUM|MAX|MIN)\s*\(/i.test(sql);
 const daily=tableOf(sql)==='student_daily_activity_totals';
 if(aggregate||daily){
   const group=sql.match(/\bGROUP\s+BY\s+(.+?)(?:\bORDER\s+BY|\bLIMIT|$)/is)?.[1].split(',').map(s=>s.trim().split('.').at(-1)!.replace(/["`]/g,''))??(daily?['student_id','day']:[]);
   const select=sql.match(/SELECT\s+([\s\S]+?)\s+FROM/i)?.[1]??'';
   const groupKeys=group.map(g=>select.match(new RegExp(`\\b${g}\\s+AS\\s+(\\w+)`,'i'))?.[1]??g);
   const map=new Map<string,Row>();
   for(const row of rows){const key=JSON.stringify(groupKeys.map(k=>row[k]));const old=map.get(key);if(!old){map.set(key,{...row});continue;}
    for(const [k,v] of Object.entries(row))if(!groupKeys.includes(k)&&typeof v==='number'){
      const expression=selectExpressions(select).find(part=>new RegExp(`\\bAS\\s+${k}\\s*$`,'i').test(part))??'';
      const max=/\bMAX\s*\(/i.test(expression),min=/\bMIN\s*\(/i.test(expression);
      old[k]=max?Math.max(old[k]??v,v):min?Math.min(old[k]??v,v):Number(old[k]??0)+v;
    }
   }
   return [...map.values()].sort((a,b)=>String(a.day??'').localeCompare(String(b.day??'')));
 }
 const order=sql.match(/\bORDER\s+BY\s+([\s\S]+?)(?:\bLIMIT|$)/i)?.[1];
 if(order){const fields=order.split(',').map(s=>({name:s.trim().split(/\s+/)[0].split('.').at(-1)!.replace(/["`]/g,''),desc:/\bDESC\b/i.test(s)}));
 rows.sort((a,b)=>{for(const {name,desc}of fields){if(a[name]===b[name])continue;const diff=typeof a[name]==='number'&&typeof b[name]==='number'?a[name]-b[name]:String(a[name]??'').localeCompare(String(b[name]??''));if(diff)return desc?-diff:diff;}return 0;});}
 return rows;
}

export function starterBank(base:BankDatabase,starter:BankDatabase,scope?:{classId:number;subjectId?:number}):BankDatabase {
 const scoped=(sql:string,table:string)=>scope&&keys[table]&&['question_bank_questions','question_bank_question_progress','question_bank_reports'].includes(table)
   ?addOuterPredicate(sql,`${table}.class_id=${scope.classId}${scope.subjectId===undefined?'':` AND ${table}.subject_id=${scope.subjectId}`}`):sql;
 const execute=async(sql:string,params:Value[],method:'all'|'first'|'run'):Promise<any>=>{
  const table=tableOf(sql);if(!keys[table]&&table!=='jam_qb_catalog_counts')return base.prepare(sql).bind(...params)[method]();
  const read=/^\s*SELECT/i.test(sql),qid=selectedQuestion(sql,params,table);
  let target:BankDatabase|undefined;
  if(qid!==undefined)target=isStarterQuestion(qid)?starter:base;
  const batchIds=read?questionBatch(sql,params,table):null;
  if(!target&&batchIds){if(batchIds.every(isStarterQuestion))target=starter;else if(batchIds.every(id=>!isStarterQuestion(id)))target=base;}
  if(!read&&/^\s*INSERT/i.test(sql)&&table==='question_bank_questions')target=String(insertParam(sql,'difficulty',params)??'').trim().toLowerCase()==='starter'?starter:base;
  if(!target&&keys[table]&&table!=='question_bank_questions'){
    const rowId=equalParam(sql,'id',params);
    if(rowId!==undefined)target=Number(rowId)>NEW_ID||(manifest[keys[table]] as number[]).includes(Number(rowId))?starter:base;
  }
  if(target)return target.prepare(sql).bind(...params)[method]();
  if(!read&&/^\s*INSERT/i.test(sql))throw Error('Starter routing requires a question identity');
  const regular=table==='jam_qb_catalog_counts'?sql:addOuterPredicate(sql,sourcePredicate(table));
  const starterSql=scoped(sql,table);
  if(!read){const results=await Promise.all([base.prepare(regular).bind(...params).run(),starter.prepare(starterSql).bind(...params).run()]);return {success:true,meta:{changes:results.reduce((n,r)=>n+Number(r.meta?.changes??0),0)}};}
  const [a,b]=await Promise.all([base.prepare(regular).bind(...params).all<Row>(),starter.prepare(starterSql).bind(...params).all<Row>()]);
  let rows=mergeStarterRows(sql,a.results,b.results);
  const limit=/\bLIMIT\s+(\?|\d+)/i.exec(sql);
  if(limit){const n=limit[1]==='?'?Number(paramAt(sql,limit.index+limit[0].indexOf('?'),params)):Number(limit[1]);rows=rows.slice(0,n);}
  return method==='first'?rows[0]??null:{results:rows};
 };
 return {prepare:sql=>({bind:(...params)=>({all:()=>execute(sql,params as Value[],'all'),first:()=>execute(sql,params as Value[],'first'),run:()=>execute(sql,params as Value[],'run')})}),
  batch:async statements=>{for(const s of statements){
   const json=s.params.findIndex(p=>typeof p==='string'&&p.startsWith('[{'));
   if(json>=0){const rows=JSON.parse(String(s.params[json]));if(rows.every((r:Row)=>r.questionId!=null||r.question_id!=null)){
    for(const [db,subset] of [[base,rows.filter((r:Row)=>!isStarterQuestion(r.questionId??r.question_id))],[starter,rows.filter((r:Row)=>isStarterQuestion(r.questionId??r.question_id))]] as const){if(!subset.length)continue;const params=[...s.params];params[json]=JSON.stringify(subset);await db.prepare(s.sql).bind(...params).run();}continue;
   }}
   await execute(s.sql,s.params,'run');
  }},
 };
}

/** Only Starter timers/activity are diverted; auth, tests and shared taxonomy stay in main. */
export function starterActivity(main:D1Database,starter:BankDatabase):D1Database {
 const execute=async(sql:string,params:unknown[],method:'all'|'first'|'run'):Promise<any>=>{
  const table=tableOf(sql);if(!mainTables.has(table))return main.prepare(sql).bind(...params)[method]();
  const read=/^\s*SELECT/i.test(sql);let target:BankDatabase|D1Database|undefined;
  if(table==='student_question_timers'){
   const qid=selectedQuestion(sql,params,table),source=insertParam(sql,'source_type',params)??(/source_type\s*=\s*'([^']+)'/i.exec(sql)?.[1]);
   if(source==='pyq')target=main;
   else if(qid!==undefined&&source==='question-bank')target=isStarterQuestion(qid)?starter:main;
  } else if(table==='student_daily_question_activity'){
   const key=insertParam(sql,'question_key',params)??equalParam(sql,'question_key',params);
   if(key!==undefined)target=String(key).startsWith('question-bank:')&&isStarterQuestion(String(key).slice(14))?starter:main;
  }
  if(target)return target.prepare(sql).bind(...params)[method]();
  if(!read)throw Error('Activity routing requires a question identity');
  const regular=table==='student_daily_activity_totals'?sql.replace(/\bstudent_daily_activity_totals\b/g,'nonstarter_daily_activity_totals'):
   addOuterPredicate(sql,table==='student_question_timers'?`(source_type != 'question-bank' OR question_id NOT IN (${manifest.questions.join(',')||'-1'}))`:`question_key NOT IN (${manifest.questions.map(id=>`'question-bank:${id}'`).join(',')||"''"})`);
  const [a,b]=await Promise.all([main.prepare(regular).bind(...params).all<Row>(),starter.prepare(sql).bind(...params).all<Row>()]);
  const rows=mergeStarterRows(sql,a.results,b.results);return method==='first'?rows[0]??null:{results:rows};
 };
 const prepare=(sql:string)=>{
  const bound=(params:unknown[]):any=>({__starterSql:sql,__starterParams:params,bind:(...next:unknown[])=>bound(next),all:()=>execute(sql,params,'all'),first:()=>execute(sql,params,'first'),run:()=>execute(sql,params,'run')});
  return bound([]);
 };
 return {prepare,batch:async(statements:any[])=>{
  // Keep unrelated D1 batches atomic; split only when a Starter statement exists.
  if(statements.every(s=>!mainTables.has(tableOf(s.__starterSql))))return main.batch(statements.map(s=>main.prepare(s.__starterSql).bind(...s.__starterParams)));
  const results=[];for(const s of statements)results.push(await execute(s.__starterSql,s.__starterParams,'run'));return results;
 }} as unknown as D1Database;
}
