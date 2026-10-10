import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from '../../api-server/node_modules/esbuild/lib/main.js';
import http from 'node:http';
import { chromium } from 'playwright';

test('recovery sends the one-use code to the server, never consumes it client-side or redirects off-site', { timeout: 30000 }, async () => {
  const output = await build({ stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './src/pages/ResetPasswordPage';createRoot(document.getElementById('root')).render(<Page/>);`, loader: 'tsx', resolveDir: new URL('..', import.meta.url).pathname },
    bundle: true, write: false, format: 'esm', platform: 'browser', jsx: 'automatic', tsconfig: new URL('../tsconfig.json', import.meta.url).pathname,
    define: { 'import.meta.env': '{}' }, plugins: [{ name: 'mock-recovery-boundaries', setup(b) {
      b.onResolve({ filter: /^@\/lib\/(firebase|api-origin)$/ }, a => ({ path: a.path, namespace: 'test' }));
      b.onLoad({ filter: /.*/, namespace: 'test' }, a => ({ contents: a.path.endsWith('firebase') ? 'export const verifyFirebaseResetCode=async()=>"admin@example.test";' : 'export const buildApiUrl=path=>path;' }));
    } }],
  });
  const calls = [];
  const server = http.createServer(async (req, res) => {
    if (req.url === '/app.js') { res.setHeader('content-type', 'text/javascript'); res.end(output.outputFiles[0].text); return; }
    if (req.url === '/api/auth/password-reset/finalize') {
      let body = ''; for await (const part of req) body += part;
      calls.push(JSON.parse(body)); res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); return;
    }
    res.setHeader('content-type', 'text/html'); res.end('<div id="root"></div><script type="module" src="/app.js"></script>');
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(5000);
    page.on('pageerror', error => console.log('Recovery browser error:', error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/reset-password?oobCode=one-use-code&continueUrl=https://evil.example.test`);
    await page.getByLabel('New password', { exact: true }).fill('safe-new-password');
    await page.getByLabel('Confirm new password', { exact: true }).fill('safe-new-password');
    await page.getByRole('button', { name: 'Save New Password', exact: true }).click();
    await page.getByText('Password updated for', { exact: false }).waitFor();
    assert.deepEqual(calls, [{ oobCode: 'one-use-code', email: 'admin@example.test', newPassword: 'safe-new-password' }]);
    assert.equal(await page.getByRole('button', { name: 'Continue' }).count(), 0);
  } finally { await browser.close(); await new Promise(r => server.close(r)); }
});
