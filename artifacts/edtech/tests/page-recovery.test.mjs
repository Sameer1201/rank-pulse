import assert from 'node:assert/strict';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';

const dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://example.test' });
Error.stackTraceLimit = 0;
for (const key of ['window', 'document', 'HTMLElement', 'Element', 'Node', 'Event', 'CustomEvent', 'MutationObserver', 'getComputedStyle']) {
  globalThis[key] = key === 'getComputedStyle' ? dom.window[key].bind(dom.window) : dom.window[key];
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const NativeChannel = globalThis.MessageChannel;
const channels = [];
globalThis.MessageChannel = class extends NativeChannel {
  constructor() { super(); channels.push(this); }
};
const output = await build({
  stdin: { contents: `
    export { default as QuestionPage } from './src/pages/student/question-bank/QuestionPage';
    export { PageErrorBoundary, PageLoading } from './src/components/PageRecovery';
    export { createRoot } from 'react-dom/client';
    export { act, createElement, lazy, Suspense } from 'react';
    export { QueryClient, QueryClientProvider } from '@tanstack/react-query';
    export { TooltipProvider } from './src/components/ui/tooltip';
  `, resolveDir: new URL('..', import.meta.url).pathname },
  bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic',
  loader: { '.css': 'empty' }, tsconfig: new URL('../tsconfig.json', import.meta.url).pathname,
  plugins: [{ name: 'question-data', setup(b) {
    const doubles = {
      'wouter': `export const useParams=()=>({examId:'gate',subjectId:'50',chapterId:'399',questionId:globalThis.questionId||'5569'}); export const useLocation=()=>['/',()=>{}]; export const Link=({children})=>children;`,
      '@/contexts/AuthContext': `export const useAuth=()=>({user:{role:'student'}});`,
      '@/hooks/use-toast': `export const useToast=()=>({toast:()=>{}});`,
      '@/lib/api': `export const api={post:(...args)=>globalThis.practicePost?.(...args)??Promise.resolve({})};`,
      '@/lib/student-access': `export const isStudentFeatureLocked=()=>false; export const isStudentPendingVerification=()=>false;`,
      '@/components/student/AiHint': `export const AiHint=()=>null;`,
      '@/components/student/AiSimilarPractice': `export default ()=>null;`,
      '@/components/student/TcsCalculator': `export const TcsCalculator=()=>null;`,
      '@/pages/student/question-bank/api': `
        export const useStudentQuestionBankStructure=()=>globalThis.questionData.structure;
        export const useStudentChapterQuestions=()=>globalThis.questionData.questions;
        export const useStudentQuestionImage=()=>({});
        export const applyPendingPreviewLocksToStructure=x=>x;
        export const formatDifficultyLabel=x=>x;
        export const getQuestionDifficultyTone=()=>'';
        export const getQuestionSolved=()=>false;
        export const getQuestionAttempted=()=>false;
      `,
    };
    b.onResolve({ filter: /.*/ }, ({ path }) => Object.hasOwn(doubles, path) ? { path, namespace: 'double' } : undefined);
    b.onLoad({ filter: /.*/, namespace: 'double' }, ({ path }) => ({ contents: doubles[path] }));
  }}],
});
const { QuestionPage, PageErrorBoundary, PageLoading, createRoot, act, createElement: h, lazy, Suspense, QueryClient, QueryClientProvider, TooltipProvider } = await import('data:text/javascript;base64,' + Buffer.from(output.outputFiles[0].text).toString('base64'));

test('cold question refresh, next question and loading transition keep the page mounted', async () => {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } } });
  const render = () => act(async () => root.render(h(QueryClientProvider, { client }, h(TooltipProvider, null, h(PageErrorBoundary, null, h(QuestionPage))))));
  try {
    globalThis.questionData = { structure: { isLoading: true }, questions: { isLoading: false } };
    await render();
    assert.match(document.body.textContent, /Loading question/);
    questionData.structure = { isLoading: false, data: { exam: { label: 'GATE EC' }, subjects: [{ id: 50, title: 'EDC', chapters: [{ id: 399, title: 'PN Junction' }] }] } };
    questionData.questions = { isLoading: true };
    await render();
    assert.match(document.body.textContent, /Loading question/);
    const questions = [5569, 5570].map(id => ({ id, question: `Question ${id} text`, options: ['1 pF', '2 pF'], correctAnswer: 0, difficulty: 'easy' }));
    questionData.questions = { isLoading: false, data: { questions } };
    await render();
    assert.match(document.body.textContent, /Question 5569 text/);
    globalThis.questionId = '5570';
    await render();
    assert.match(document.body.textContent, /Question 5570 text/);
    questionData.questions = { isLoading: true };
    await render();
    questionData.questions = { isLoading: false, data: { questions } };
    await render();
    assert.match(document.body.textContent, /Question 5570 text/);
    assert.doesNotMatch(document.body.textContent, /couldn’t load/);
  } finally {
    await act(async () => root.unmount());
    client.clear();
  }
});

test('practice ignores historic progress, blocks duplicate submits and preserves answers across navigation', async () => {
  const root = createRoot(document.getElementById('root'));
  const client = new QueryClient({ defaultOptions: { queries: { gcTime: 0 }, mutations: { gcTime: 0 } } });
  const pending = [];
  globalThis.practicePost = (url, body) => new Promise(resolve => pending.push({ url, body, resolve }));
  const render = () => act(async () => root.render(h(QueryClientProvider, { client }, h(TooltipProvider, null, h(QuestionPage)))));
  const click = async (text, twice = false) => act(async () => {
    const button = [...document.querySelectorAll('button')].find(el => el.textContent.includes(text));
    assert.ok(button, `Button missing: ${text}`);
    button.click();
    if (twice) button.click();
  });
  try {
    globalThis.questionData = {
      structure: { isLoading: false, data: { exam: { label: 'GATE EC' }, subjects: [{ id: 50, title: 'EDC', chapters: [{ id: 399, title: 'PN Junction' }] }] } },
      questions: { isLoading: false, data: { questions: [8001, 8002, 8003].map(id => ({ id,
        question: `Question ${id}`, options: ['Correct option', 'Wrong option'], correctAnswer: 0,
        difficulty: 'easy', progress: { lastIsCorrect: true } })) } },
    };
    globalThis.questionId = '8002';
    await render();
    await click('Correct option');
    await click('Submit Answer', true);
    assert.equal(pending.length, 1);
    assert.match(document.body.textContent, /1 in a row/);
    globalThis.questionId = '8003';
    await render();
    await click('Wrong option');
    await click('Submit Answer');
    assert.equal(pending.length, 2);
    assert.doesNotMatch(document.body.textContent, /in a row/);
    await act(async () => { pending[0].resolve({ isCorrect: true }); await new Promise(r => setTimeout(r, 10)); });
    assert.match(document.body.textContent, /Incorrect/);
    assert.doesNotMatch(document.body.textContent, /in a row/);
    await act(async () => { pending[1].resolve({ isCorrect: false }); await new Promise(r => setTimeout(r, 10)); });
    globalThis.questionId = '8002';
    await render();
    assert.match(document.body.textContent, /Correct! Well done/);
    assert.doesNotMatch(document.body.textContent, /Submit Answer|in a row/);
    assert.equal(pending.length, 2);
  } finally {
    await act(async () => root.unmount());
    client.clear();
    delete globalThis.practicePost;
  }
});

test('pending route shows a loader, rejected route shows recovery and navigation clears it', async () => {
  const root = createRoot(document.getElementById('root'));
  let resolvePage;
  const Pending = lazy(() => new Promise(resolve => { resolvePage = resolve; }));
  const render = (child, resetKey = '/first') => act(async () => root.render(h(PageErrorBoundary, { resetKey }, h(Suspense, { fallback: h(PageLoading) }, child))));
  const originalError = console.error;
  try {
    await render(h(Pending));
    assert.match(document.body.textContent, /Loading your page/);
    await act(async () => resolvePage({ default: () => h('p', null, 'Question loaded') }));
    assert.match(document.body.textContent, /Question loaded/);
    console.error = () => {};
    const Broken = lazy(async () => { throw new Error('test render failure'); });
    await render(h(Broken));
    assert.match(document.body.textContent, /This page couldn’t load/);
    assert.equal(document.querySelector('button').textContent, 'Reload page');
    await render(h('p', null, 'Next page loaded'), '/second');
    assert.match(document.body.textContent, /Next page loaded/);
  } finally {
    console.error = originalError;
    await act(async () => root.unmount());
    for (const channel of channels) { channel.port1.close(); channel.port2.close(); }
    dom.window.close();
  }
});
