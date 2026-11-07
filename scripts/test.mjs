#!/usr/bin/env node
// The test tiers (the rules are in CLAUDE.md, TESTING):
//   npm run test:fast                                  no browser: every test that doesn't use Playwright
//   npm run test:browser -- tests/notes-cap-touch.test.mjs  headless browser specs, named one by one
//   npm run bench -- globe                             FPS and frame times: only when asked for
// After `--`, node's test flags go through too, e.g. --test-name-pattern="panda".
//
// Hard limits, whatever is run: TEST_MS a test, RUN_MS a run. Past RUN_MS the whole process tree is
// killed. A test past TEST_MS is cancelled, and --test-force-exit ends its file, or an abandoned
// timer would hold it open. Its finally never ran, so browsers still open are killed at the end: only
// Playwright's own (by where they are installed) and only those started by this run.
import { spawn, execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST_MS = 30_000;
const RUN_MS = 5 * 60_000;
const WINDOWS = process.platform === 'win32';

const [tier, ...args] = process.argv.slice(2);

function refuse(message) {
  console.error(message);
  process.exit(2);
}

if (args.some(a => /^--watch/.test(a))) refuse('No watch mode: every run ends.');

const usesBrowser = file => /from 'playwright'|import\('playwright'\)|fixtures\/notes-browser/.test(readFileSync(path.join(ROOT, file), 'utf8'));
const allTests = () => readdirSync(path.join(ROOT, 'tests')).filter(f => f.endsWith('.test.mjs')).map(f => `tests/${f}`);
const isFile = a => !a.startsWith('-');

function plan() {
  const files = args.filter(isFile), flags = args.filter(a => !isFile(a));
  const test = list => [process.execPath, ['--test', `--test-timeout=${TEST_MS}`, '--test-force-exit', ...flags, ...list]];
  if (tier === 'fast') {
    const list = files.length ? files : allTests().filter(f => !usesBrowser(f));
    const browser = list.filter(usesBrowser);
    if (browser.length) refuse(`These use a browser, so they aren't test:fast: ${browser.join(', ')}`);
    return { label: 'test:fast', count: list.length, command: test(list) };
  }
  if (tier === 'browser') {
    const specs = allTests().filter(usesBrowser);
    if (!files.length) refuse(`test:browser runs only the specs for what changed. Name them:\n  npm run test:browser -- ${specs[0]}\nSpecs: ${specs.join(', ')}`);
    return { label: 'test:browser', count: files.length, browsers: true, command: test(files) };
  }
  if (tier === 'bench') {
    if (!args.length) refuse('Benchmarks run only when asked for. Usage: npm run bench -- globe|notes (see scripts/bench.mjs)');
    return { label: `bench ${args[0]}`, count: 1, browsers: true, command: [process.execPath, [path.join(ROOT, 'scripts/bench.mjs'), ...args]] };
  }
  return refuse('Usage: node scripts/test.mjs fast|browser|bench');
}

// The process and everything it started.
function killTree(child) {
  try {
    if (WINDOWS) execFileSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
    else process.kill(-child.pid, 'SIGKILL');
  } catch { /* already gone */ }
}

// Playwright's browsers left by this run. They are matched by where they are installed, so a
// browser of your own is never touched. Returns how many went.
function killBrowsers(since) {
  try {
    if (WINDOWS) {
      const script = `$since = [datetime]'${new Date(since).toISOString()}'
$left = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -like '*ms-playwright*' -and $_.CreationDate.ToUniversalTime() -ge $since.ToUniversalTime() })
$left | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$left.Count`;
      return Number(execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' }).trim()) || 0;
    }
    execFileSync('pkill', ['-f', 'ms-playwright'], { stdio: 'ignore' });
    return 1;
  } catch { return 0; }
}

const { label, count, browsers, command: [bin, list] } = plan();
const started = Date.now();
const child = spawn(bin, list, { cwd: ROOT, stdio: 'inherit', detached: !WINDOWS });
let timedOut = false;
const limit = setTimeout(() => { timedOut = true; killTree(child); }, RUN_MS);
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => killTree(child));

child.on('close', code => {
  clearTimeout(limit);
  const left = browsers ? killBrowsers(started) : 0;
  const took = ((Date.now() - started) / 1000).toFixed(1);
  const result = timedOut ? `TIMED OUT at ${RUN_MS / 60000} min, process tree killed` : code === 0 ? 'passed' : `FAILED (exit ${code})`;
  console.log(`\n${label}: ${result}, ${count} file${count === 1 ? '' : 's'}, ${took} s${left ? `; ${left} browser process${left === 1 ? '' : 'es'} left behind and killed` : ''}`);
  process.exit(timedOut ? 124 : code ?? 1);
});
