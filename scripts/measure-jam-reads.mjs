import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { build } from '../artifacts/api-server/node_modules/esbuild/lib/main.js';

const mode = process.argv[2];
if (!['before','after'].includes(mode)) throw new Error('Usage: node scripts/measure-jam-reads.mjs before|after');
const bundle = await build({ entryPoints: ['artifacts/api-server/src/lib/jamCatalogQueries.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const queries = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text).toString('base64'));
const student = '(SELECT MIN(student_id) FROM pyq_question_progress)';
const literal = value => `'${value.replaceAll("'", "''")}'`;
const bind = (sql, params) => { let i = 0; return sql.replaceAll('?', () => params[i++]); };
const cases = [
  { name:'subject-overview', sql: mode === 'after'
    ? bind(queries.JAM_PYQ_SUBJECTS_SQL,[student,literal('JAM Chemistry'),literal('JAM Chemistry')])
    : `SELECT exam,subject,COUNT(*) questionCount,COUNT(DISTINCT NULLIF(chapter,'')) chapterCount,COUNT(DISTINCT progress.question_id) attemptedCount
       FROM pyq_questions LEFT JOIN pyq_question_progress progress ON progress.question_id=pyq_questions.id AND progress.student_id=${student}
       WHERE exam='JAM Chemistry' GROUP BY exam,subject ORDER BY subject COLLATE NOCASE,exam COLLATE NOCASE` },
  { name:'chapter-overview', sql: mode === 'after'
    ? bind(queries.JAM_PYQ_CHAPTERS_SQL,[student,literal('JAM Chemistry'),literal('Physical Chemistry'),literal('JAM Chemistry'),literal('Physical Chemistry')])
    : `SELECT CASE WHEN chapter='' THEN 'General' ELSE chapter END chapter,MIN(chapter_order) chapterOrder,COUNT(*) questionCount,COUNT(DISTINCT progress.question_id) attemptedCount
       FROM pyq_questions LEFT JOIN pyq_question_progress progress ON progress.question_id=pyq_questions.id AND progress.student_id=${student}
       WHERE exam='JAM Chemistry' AND subject='Physical Chemistry' GROUP BY CASE WHEN chapter='' THEN 'General' ELSE chapter END ORDER BY chapterOrder,chapter COLLATE NOCASE` },
  { name:'chapter-ordered-ids', sql:`SELECT id FROM pyq_questions WHERE exam='JAM Chemistry' AND subject='Physical Chemistry' AND chapter='Chemical Kinetics' ORDER BY chapter_order,question_number,year DESC,id DESC LIMIT 100` },
  { name:'exam-count', sql: mode === 'after'
    ? `SELECT COALESCE(SUM(question_count),0) totalCount FROM jam_pyq_catalog_counts WHERE exam='JAM Chemistry'`
    : `SELECT COUNT(*) totalCount FROM pyq_questions WHERE exam='JAM Chemistry'` },
];
const result = spawnSync('npx',['--yes','wrangler@4.137.0','d1','execute','jam-chemistry','--remote','--config','artifacts/jam-content-worker/wrangler.toml','--command',cases.map(q=>q.sql).join(';'),'--json'], {encoding:'utf8',maxBuffer:4*1024*1024});
if(result.status!==0) throw new Error(result.stderr || result.stdout);
const outputs = JSON.parse(result.stdout);
const measurements = cases.map((q,i) => ({ name:q.name, rowsReturned:outputs[i].results.length,
  rowsRead:outputs[i].meta.rows_read, durationMs:outputs[i].meta.duration,
  resultHash:createHash('sha256').update(JSON.stringify(outputs[i].results.map(row=>Object.fromEntries(Object.entries(row).sort(([a],[b])=>a.localeCompare(b)))))).digest('hex'),
}));
const directory='artifacts/api-server/verification/20261003';
mkdirSync(directory,{recursive:true});
if(mode==='after') {
  const before=JSON.parse(readFileSync(`${directory}/jam-reads-before.json`,'utf8'));
  for(let i=0;i<measurements.length;i++) {
    if(measurements[i].resultHash!==before.measurements[i].resultHash) throw new Error(`Result changed: ${measurements[i].name}`);
  }
}
writeFileSync(`${directory}/jam-reads-${mode}.json`,JSON.stringify({mode,checkedAt:new Date().toISOString(),measurements},null,2)+'\n');
console.log(JSON.stringify(measurements.map(({resultHash,...measurement})=>measurement),null,2));
