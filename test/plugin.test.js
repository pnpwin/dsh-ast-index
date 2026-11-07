import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, readFile, utimes, access, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { parseInput, buildCommand, quote, clip, createTool, apply } from '../src/index.js';
const run = promisify(execFile);
const astExecutable = process.env.AST_INDEX_BIN || 'ast-index';

function mockContext({ mode = 'workspace-write', outside = false, result, runShell } = {}) {
  const seen = [];
  return {
    seen,
    sandboxPolicy: { resolve: arg => { seen.push(['policy', arg]); return { mode, workspaceRoot: '/workspace' }; } },
    workingDirectory: { ensure: async () => '/workspace' },
    fs: {
      resolve: async (p, options) => ({ displayPath: path.resolve(options?.cwd ?? '/', p) }),
      contains: (p, c) => !outside && (c.displayPath === p.displayPath || c.displayPath.startsWith(p.displayPath + '/')),
      stat: async () => ({ type: 'directory' }),
      processPath: target => target.displayPath
    },
    subprocess: { resolveExecutable: async () => '/usr/local/bin/ast-index' },
    shell: {
      resolve: request => request,
      execute: async spec => {
        seen.push(['shell', spec]);
        if (runShell) return { result: () => runShell(spec) };
        return { result: async () => result ?? { exitCode: 0, stdout: { text: 'Found foo', truncated: false }, stderr: { text: '' } } };
      }
    }
  };
}
const exec = () => ({ agent: { session: { id: 'test' } }, signal: new AbortController().signal });

test('package loads from src and root stays free of source files', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.equal(manifest.exports['.'], './src/index.js');
  const allowed = ['.gitignore', 'CHANGELOG.md', 'LICENSE', 'README.md', 'README.ru.md', 'THIRD_PARTY_NOTICES.md', 'cordis.patch.yml', 'icon.svg', 'package.json'].sort();
  const rootFiles = (await readdir(new URL('../', import.meta.url), { withFileTypes: true }))
    .filter(entry => !entry.isDirectory()).map(entry => entry.name).sort();
  assert.deepEqual(rootFiles, allowed);
});

test('small defaults and all intended actions', () => {
  assert.equal(parseInput({ action: 'symbol', query: 'foo' }).limit, 10);
  for (const action of ['search', 'symbol', 'outline', 'refs', 'implementations', 'explore', 'map', 'stats']) {
    assert.equal(parseInput({ action, query: 'foo' }).action, action);
  }
});
test('rejects raw commands, options, unknown keys and unbounded values', () => {
  for (const input of [
    { action: 'query', query: 'DELETE FROM files' },
    { action: 'symbol', query: '--help' },
    { action: 'symbol', query: 'a\nb' },
    { action: 'symbol', query: 'foo', limit: 0 },
    { action: 'symbol', query: 'foo', limit: 51 },
    { action: 'symbol', query: 'foo', maxChars: 500000 },
    { action: 'symbol', query: 'foo', content: 'yes' },
    { action: 'stats', inFile: 'x' },
    { action: 'stats', arbitrary: true },
    JSON.parse('{"action":"stats","__proto__":true}')
  ]) assert.throws(() => parseInput(input));
});
test('shell quoting preserves metacharacters as data', async () => {
  const text = "name'; echo BAD; $(id) `id` ; #";
  const { stdout } = await run('/bin/bash', ['-c', `printf %s ${quote(text)}`]);
  assert.equal(stdout, text);
  const command = buildCommand('/bin/ast-index', parseInput({ action: 'explore', query: text, limit: 50 }));
  assert.ok(command.includes("'--max-files' '6'"));
  assert.ok(command.includes('env -i'));
  assert.ok(command.includes('AST_INDEX_DISABLE_GC=1'));
});
test('character budget includes truncation notice', () => {
  const result = clip('z'.repeat(10000), 500);
  assert.equal(result.text.length, 500);
  assert.equal(result.truncated, true);
  assert.equal(clip('ok', 500).truncated, false);
});
test('requires a session and denies readonly/outside projects before process start', async () => {
  await assert.rejects(createTool(mockContext()).execute({ action: 'stats' }, { signal: exec().signal }), /requires a session/);
  for (const options of [{ mode: 'read-only' }, { outside: true }]) {
    const ctx = mockContext(options);
    await assert.rejects(createTool(ctx).execute({ action: 'stats' }, exec()));
    assert.equal(ctx.seen.filter(x => x[0] === 'shell').length, 0);
  }
  await assert.rejects(createTool(mockContext()).execute({ action: 'outline', query: '../secret.ts' }, exec()), /inside project/);
});
test('propagates policy, cancellation, cache isolation, output limits', async () => {
  const ctx = mockContext();
  const call = exec();
  const tool = createTool(ctx);
  const result = await tool.execute({ action: 'symbol', query: 'foo' }, call);
  const spec = ctx.seen.find(x => x[0] === 'shell')[1];
  assert.equal(spec.sandboxPolicy.mode, 'workspace-write');
  assert.equal(spec.signal, call.signal);
  assert.equal(spec.env.AST_INDEX_CACHE_DIR, '/workspace/.dsh-ast-index');
  assert.equal(spec.onExpiry, 'kill');
  assert.equal(spec.stdoutMaxBytes, 128000);
  assert.match(result.refresh, /full rebuild/);
  assert.equal(tool.output.render({}, result).length, 1);
});
test('refresh failures never return stale search results', async () => {
  for (const extra of [{ exitCode: 1 }, { timedOut: true }, { aborted: true }, { sandbox: { denied: true } }, { sandbox: { runnerFailed: true } }]) {
    const ctx = mockContext({ result: { exitCode: 0, stdout: { text: 'stale' }, stderr: { text: 'failure' }, ...extra } });
    await assert.rejects(createTool(ctx).execute({ action: 'stats' }, exec()), /no stale fallback/);
  }
});
test('registration is owned by the plugin effect', () => {
  let registration;
  let disposed = false;
  const cleanup = () => { disposed = true; };
  let effectDisposer;
  const ctx = { ...mockContext(), tools: { register: def => { registration = def; return cleanup; } }, effect: cb => { effectDisposer = cb(); } };
  apply(ctx, {});
  assert.equal(registration.name, 'ast_index');
  assert.equal(effectDisposer, cleanup);
  effectDisposer();
  assert.equal(disposed, true);
});
test('same project calls serialize; aborted queued calls do not spawn', async () => {
  let release;
  const waiting = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const ctx = mockContext({ runShell: async () => {
    calls++;
    if (calls === 1) await waiting;
    return { exitCode: 0, stdout: { text: 'ok' }, stderr: { text: '' } };
  } });
  const tool = createTool(ctx);
  const first = tool.execute({ action: 'stats' }, exec());
  const controller = new AbortController();
  const second = tool.execute({ action: 'stats' }, { ...exec(), signal: controller.signal });
  const rejected = assert.rejects(second, /abort/i);
  controller.abort();
  await rejected;
  assert.equal(calls, 1);
  release();
  await first;
  assert.equal(calls, 1);
});

test('real CLI: locate TS/Python definitions, refs, literals distinction, same-size edit and deletion', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'dsh-ast-test-'));
  const project = path.join(root, 'project');
  await mkdir(project);
  await writeFile(path.join(project, 'package.json'), '{"name":"fixture"}');
  const file = path.join(project, 'service.ts');
  const source = 'export function processPayment(amount: number) { return amount * 2; }\nexport function checkout() { return processPayment(4); }\n// processPayment comment\nconst text = "processPayment";\n';
  await writeFile(file, source);
  await writeFile(path.join(project, 'worker.py'), 'def reconcile_payment(amount):\n    return amount * 3\n');
  const cache = path.join(root, '.dsh-ast-index');
  const cli = async input => {
    const command = buildCommand(astExecutable, parseInput(input));
    return (await run('/bin/bash', ['-c', command], { cwd: project, env: { ...process.env, AST_INDEX_CACHE_DIR: cache, AST_INDEX_TEST_REFRESH_STARTED_FILE: path.join(root, 'must-not-exist') }, maxBuffer: 4e6 })).stdout;
  };
  assert.match(await cli({ action: 'symbol', query: 'processPayment', content: true }), /return amount \* 2/);
  assert.match(await cli({ action: 'symbol', query: 'reconcile_payment' }), /worker\.py:1/);
  assert.match(await cli({ action: 'refs', query: 'processPayment' }), /service\.ts:2/);
  const refs = await cli({ action: 'refs', query: 'processPayment' });
  assert.doesNotMatch(refs, /comment|const text/);
  const fixedTime = new Date(Math.floor(Date.now() / 1000) * 1000);
  await utimes(file, fixedTime, fixedTime);
  await cli({ action: 'stats' });
  const modified = source.replaceAll('processPayment', 'capturePayment');
  assert.equal(modified.length, source.length);
  await writeFile(file, modified);
  await utimes(file, fixedTime, fixedTime);
  assert.match(await cli({ action: 'symbol', query: 'capturePayment' }), /service\.ts:1/);
  assert.doesNotMatch(await cli({ action: 'symbol', query: 'processPayment' }), /service\.ts:1/);
  await writeFile(file, '// deleted all symbols\n');
  assert.doesNotMatch(await cli({ action: 'symbol', query: 'capturePayment' }), /service\.ts:1/);
  assert.match(await readFile(path.join(project, 'worker.py'), 'utf8'), /reconcile_payment/);
  await assert.rejects(access(path.join(root, 'must-not-exist')), { code: 'ENOENT' });
});

test('exit-zero partial rebuild or lost diagnostics fails closed', async () => {
  for (const stderr of [
    { text: 'Done: 2 sub-projects indexed, 1 failed' },
    { text: '  Failed: candidate-file cap exceeded' },
    { text: 'lost prefix', truncated: true }
  ]) {
    const ctx = mockContext({ result: { exitCode: 0, stdout: { text: 'partial result' }, stderr } });
    await assert.rejects(createTool(ctx).execute({ action: 'stats' }, exec()), /incomplete rebuild/);
  }
});
test('warnings survive and shell-level truncation is visible', async () => {
  const ctx = mockContext({ result: { exitCode: 0, stdout: { text: 'short', truncated: true }, stderr: { text: 'Warning: skipped unreadable file' } } });
  const tool = createTool(ctx);
  const result = await tool.execute({ action: 'stats' }, exec());
  assert.match(result.output, /Warning: skipped/);
  assert.match(tool.output.render({}, result)[0].text, /Output truncated/);
});
