import path from 'node:path';

export const inject = ['tools', 'shell', 'sandboxPolicy', 'workingDirectory', 'fs', 'subprocess'];

const ACTIONS = ['search', 'symbol', 'outline', 'refs', 'implementations', 'explore', 'map', 'stats'];
export const toolSchema = {
  name: 'ast_index',
  description: 'Find code definitions, references or file outlines with ast-index. Rebuilds a local cache before each request. Prefer symbol for identifiers, explore for topics; use grep for literals/comments and read for exact edits. References are candidates, not a complete semantic call graph.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ACTIONS },
      query: { type: 'string', description: 'Identifier, topic, or project-relative file for outline.' },
      project: { type: 'string', description: 'Project root inside the session workspace; defaults to current directory.' },
      inFile: { type: 'string', description: 'Path filter for search, symbol or refs.' },
      limit: { type: 'integer', description: 'Results per section, 1–50; default 10. Explore: files, capped at 6.' },
      content: { type: 'boolean', description: 'Include source bodies for search/symbol; default false.' },
      maxChars: { type: 'integer', description: 'Output character budget, 500–24000; default 6000. Narrow query if truncated.' }
    },
    required: ['action'],
    additionalProperties: false
  }
};

function boundedInteger(value, fallback, low, high, name) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < low || value > high) throw new Error(`${name} must be ${low}–${high}`);
  return value;
}

function argument(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\x00-\x1f]/.test(value) || value.startsWith('-')) {
    throw new Error(`${name} must be nonempty text, not an option (max 1000 characters)`);
  }
  return value;
}

export function parseInput(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Expected an object');
  for (const key of Object.keys(raw)) {
    if (!Object.hasOwn(toolSchema.parameters.properties, key)) throw new Error(`Unknown parameter: ${key}`);
  }
  const { action } = raw;
  if (!ACTIONS.includes(action)) throw new Error('Unknown action');
  const limit = boundedInteger(raw.limit, 10, 1, 50, 'limit');
  const maxChars = boundedInteger(raw.maxChars, 6000, 500, 24000, 'maxChars');
  if (raw.content !== undefined && typeof raw.content !== 'boolean') throw new Error('content must be boolean');
  const query = ['map', 'stats'].includes(action) ? undefined : argument(raw.query, 'query');
  if (raw.content && !['search', 'symbol'].includes(action)) throw new Error('content only applies to search/symbol');
  if (raw.inFile !== undefined && !['search', 'symbol', 'refs'].includes(action)) throw new Error('inFile only applies to search/symbol/refs');
  const inFile = raw.inFile === undefined ? undefined : argument(raw.inFile, 'inFile');
  const project = raw.project === undefined ? '.' : argument(raw.project, 'project');
  return { action, query, project, inFile, limit, maxChars, content: raw.content === true };
}

export const quote = value => `'${String(value).replaceAll("'", "'\\''")}'`;

export function buildCommand(executable, input) {
  // Do not forward test hooks, DB overrides, VCS executables or credentials to the CLI.
  const env = 'env -i "PATH=$PATH" "HOME=$HOME" "TMPDIR=${TMPDIR:-/tmp}" "AST_INDEX_CACHE_DIR=$AST_INDEX_CACHE_DIR" AST_INDEX_DISABLE_GC=1 NO_COLOR=1 CLICOLOR=0';
  const base = `${env} ${quote(executable)}`;
  // Foreground full refresh avoids upstream second-resolution mtime+size collisions.
  const refresh = `${base} rebuild --exclude .dsh-ast-index --max-files 100000 --threads 4 >&2`;
  const argv = [executable, '--local', input.action];
  if (input.query !== undefined) argv.push(input.query);
  if (['search', 'symbol', 'refs', 'implementations'].includes(input.action)) argv.push('--limit', String(input.limit));
  if (input.action === 'explore') argv.push('--max-files', String(Math.min(input.limit, 6)));
  if (input.inFile) argv.push('--in-file', input.inFile);
  if (input.content) argv.push('--with-content');
  return `${refresh} && ${env} ${argv.map(quote).join(' ')}`;
}

export function clip(text, budget) {
  if (text.length <= budget) return { text, truncated: false };
  const notice = '\n[Output truncated. Narrow query/inFile, reduce limit, or increase maxChars.]';
  return { text: text.slice(0, budget - notice.length) + notice, truncated: true };
}

export function createTool(ctx, config = {}) {
  const configured = config.executable ?? 'ast-index';
  if (typeof configured !== 'string' || !configured) throw new Error('executable must be a CLI path or name');
  const queues = new Map();
  return {
    ...toolSchema,
    timeoutMs: 125000,
    isConcurrencySafe: () => false,
    output: {
      schema: {
        type: 'object',
        properties: {
          project: { type: 'string' }, action: { type: 'string' }, output: { type: 'string' },
          truncated: { type: 'boolean' }, refresh: { type: 'string' }, elapsedMs: { type: 'number' }
        },
        required: ['project', 'action', 'output', 'truncated', 'refresh', 'elapsedMs'],
        additionalProperties: false
      },
      render: (_args, result) => [{ type: 'text', text: `Project: ${result.project}\nRefresh: ${result.refresh}\n${result.truncated ? '[Output truncated; narrow query or increase maxChars.]\n' : ''}${result.output}` }]
    },
    async execute(raw, exec) {
      const input = parseInput(raw);
      if (!exec.agent) throw new Error('ast_index requires a session');
      const policy = ctx.sandboxPolicy.resolve({ session: exec.agent.session });
      if (policy.mode === 'read-only') throw new Error('ast_index needs workspace-write for its derived cache. Use grep/read in read-only mode.');
      const cwd = await ctx.workingDirectory.ensure(exec.agent, exec.signal);
      const rootTarget = await ctx.fs.resolve(policy.workspaceRoot, { signal: exec.signal });
      const projectTarget = await ctx.fs.resolve(input.project, { cwd, signal: exec.signal });
      if (!ctx.fs.contains(rootTarget, projectTarget)) throw new Error('project must be inside the session workspace');
      const info = await ctx.fs.stat(projectTarget, exec.signal);
      if (info?.type !== 'directory') throw new Error('project must be a directory');
      const project = ctx.fs.processPath(projectTarget);
      const cache = path.join(ctx.fs.processPath(rootTarget), '.dsh-ast-index');
      if (input.action === 'outline') {
        const file = await ctx.fs.resolve(input.query, { cwd: project, signal: exec.signal });
        if (!ctx.fs.contains(projectTarget, file)) throw new Error('outline file must be inside project');
      }
      const previous = queues.get(project) ?? Promise.resolve();
      const operation = previous.catch(() => {}).then(async () => {
        exec.signal.throwIfAborted();
        const executable = await ctx.subprocess.resolveExecutable(configured, undefined, exec.signal);
        const start = performance.now();
        const handle = await ctx.shell.execute(ctx.shell.resolve({
          command: buildCommand(executable, input),
          workdir: project,
          timeoutMs: 110000,
          onExpiry: 'kill',
          stdoutMaxBytes: 128000,
          signal: exec.signal,
          sandboxPolicy: policy,
          env: {
            AST_INDEX_CACHE_DIR: cache, AST_INDEX_DB_PATH: '', KOTLIN_INDEX_DB_PATH: '',
            AST_INDEX_WALK_UP: '0', NO_COLOR: '1', CLICOLOR: '0'
          }
        }));
        const result = await handle.result();
        if (result.sandbox?.denied || result.sandbox?.runnerFailed || result.timedOut || result.aborted || result.exitCode !== 0) {
          const reason = result.sandbox?.denied ? 'sandbox denied' : result.timedOut ? 'timeout' : result.aborted ? 'cancelled' : `exit ${result.exitCode}`;
          throw new Error(`ast-index ${reason}; no stale fallback. ${clip(result.stderr.text || result.stdout.text, 1500).text}`);
        }
        if (result.stderr.truncated || /\bFailed:|\b[1-9]\d* failed\b/i.test(result.stderr.text)) {
          throw new Error(`ast-index incomplete rebuild; no stale fallback. ${clip(result.stderr.text, 1500).text}`);
        }
        const warnings = result.stderr.text.split('\n').filter(line => /warn|skip|could not|error/i.test(line)).join('\n');
        const text = (warnings ? `[Index diagnostics]\n${clip(warnings, 1000).text}\n` : '') + result.stdout.text.trim();
        const bounded = clip(text, input.maxChars);
        return {
          project, action: input.action, output: bounded.text || '(No results)',
          truncated: bounded.truncated || result.stdout.truncated,
          refresh: 'full rebuild before query; concurrent edits may still require retry',
          elapsedMs: Math.round(performance.now() - start)
        };
      });
      queues.set(project, operation);
      const cleanup = () => { if (queues.get(project) === operation) queues.delete(project); };
      operation.then(cleanup, cleanup);
      return new Promise((resolve, reject) => {
        const abort = () => reject(exec.signal.reason ?? new Error('Cancelled'));
        if (exec.signal.aborted) abort();
        else exec.signal.addEventListener('abort', abort, { once: true });
        operation.then(resolve, reject).finally(() => exec.signal.removeEventListener('abort', abort));
      });
    }
  };
}

export function apply(ctx, config) {
  ctx.effect(() => ctx.tools.register(createTool(ctx, config)));
}
