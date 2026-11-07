import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, lstat, readdir } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const run = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const expected = [
  'package.json', 'src/runtime.js', 'src/index.js', 'cordis.patch.yml', 'locale/en.json', 'locale/ru.json',
  'icon.svg', 'README.md', 'README.ru.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md', 'CHANGELOG.md', 'docs/evaluation.md'
].sort();
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
assert.equal(manifest.name, '@pnpwin/dsh-ast-index');
assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
assert.equal(manifest.exports['.'], './src/index.js');
const allowedRootFiles = ['.gitignore', 'CHANGELOG.md', 'LICENSE', 'README.md', 'README.ru.md', 'THIRD_PARTY_NOTICES.md', 'cordis.patch.yml', 'icon.svg', 'package.json'].sort();
const actualRootFiles = (await readdir(root, { withFileTypes: true })).filter(entry => !entry.isDirectory()).map(entry => entry.name).sort();
assert.deepEqual(actualRootFiles, allowedRootFiles, 'Root must contain only documentation and required metadata/resources');
assert.ok(!manifest.dependencies || Object.keys(manifest.dependencies).length === 0);
for (const lifecycle of ['preinstall', 'install', 'postinstall', 'prepare', 'prepack', 'postpack']) assert.equal(manifest.scripts?.[lifecycle], undefined);

const sensitive = /(?:\/Users\/[^/]+\/|\/home\/[^/]+\/|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)/;
async function checkText(relative) {
  const file = path.join(root, relative);
  assert.equal((await lstat(file)).isSymbolicLink(), false, `Symlink forbidden: ${relative}`);
  const text = await readFile(file, 'utf8');
  assert.equal(sensitive.test(text), false, `Potential secret or machine path: ${relative}`);
  if (relative.endsWith('.md')) {
    for (const match of text.matchAll(/\]\(<([^>]+)>\)/g)) {
      const link = match[1].split('#')[0];
      if (!link || /^https?:/.test(link)) continue;
      const target = path.resolve(path.dirname(file), decodeURIComponent(link));
      assert.ok(target === root || target.startsWith(root + path.sep), `External local link: ${relative}`);
      await lstat(target);
    }
  }
}
for (const file of expected) await checkText(file);
for (const directory of ['test', 'scripts', '.github/workflows']) {
  for (const file of await readdir(path.join(root, directory))) await checkText(`${directory}/${file}`);
}
for (const language of ['en', 'ru']) {
  const locale = JSON.parse(await readFile(path.join(root, `locale/${language}.json`), 'utf8'));
  assert.ok(locale.meta.title && locale.meta.description);
}
const svg = await readFile(path.join(root, 'icon.svg'), 'utf8');
assert.ok(svg.includes('<svg xmlns="http://www.w3.org/2000/svg"'));
assert.ok(Buffer.byteLength(svg) <= 256 * 1024);

const packed = await mkdtemp(path.join(os.tmpdir(), 'dsh-ast-package-'));
await run('bun', ['pm', 'pack', '--ignore-scripts', '--destination', packed], { cwd: root });
const archives = (await readdir(packed)).filter(file => file.endsWith('.tgz'));
assert.equal(archives.length, 1);
const archive = path.join(packed, archives[0]);
const listing = (await run('tar', ['-tzf', archive])).stdout.trim().split('\n').filter(file => !file.endsWith('/'));
assert.deepEqual(listing.sort(), expected.map(file => `package/${file}`).sort(), 'Unexpected archive inventory');
const verbose = (await run('tar', ['-tvzf', archive])).stdout;
assert.ok(!verbose.split('\n').some(line => /^[lh]/.test(line)), 'Archive must not contain links');
const unpacked = await mkdtemp(path.join(os.tmpdir(), 'dsh-ast-unpacked-'));
await run('tar', ['-xzf', archive, '-C', unpacked]);
const extractedRoot = path.join(unpacked, 'package');
const extractedManifest = JSON.parse(await readFile(path.join(extractedRoot, 'package.json'), 'utf8'));
const plugin = await import(pathToFileURL(path.join(extractedRoot, extractedManifest.exports['.'])).href);
assert.equal(typeof plugin.apply, 'function');
assert.equal(typeof plugin.createTool, 'function');
assert.equal(plugin.toolSchema.name, 'ast_index');
assert.equal(plugin.parseInput({ action: 'stats' }).maxChars, 6000);
assert.ok(plugin.inject.includes('shell') && plugin.inject.includes('sandboxPolicy'));
console.log(JSON.stringify({ name: manifest.name, version: manifest.version, packedFiles: listing.length, importSmokeTest: 'passed', sourcePrivacyScan: 'passed', localDocLinks: 'passed', dependencies: 0 }, null, 2));
