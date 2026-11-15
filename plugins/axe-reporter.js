import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { createServer } from 'vite';
import { glob } from 'glob';
import { basename } from 'node:path';

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPORT_PATH = resolve(PROJECT_ROOT, 'reports', 'axe-results.json');
const REPORT_DISPLAY_PATH = 'reports/axe-results.json';
const SIGNOFF_PATH = 'reports/accessibility-statement.md';
const AXE_TAGS = [
  'wcag2a',
  'wcag2aa',
  'wcag21a',
  'wcag21aa',
  'section508',
  'best-practice',
].join(',');
const IMPACTS = ['critical', 'serious', 'moderate', 'minor', 'unknown'];
const ANSI_ESCAPE = /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

function pageResults(results) {
  return Array.isArray(results) ? results : [results];
}

export function summarizeAxeResults(results) {
  const summary = {
    impacts: Object.fromEntries(IMPACTS.map((impact) => [impact, { nodes: 0, rules: new Map() }])),
    totalNodes: 0,
    totalRules: 0,
    incompleteNodes: 0,
  };
  const ruleIds = new Set();

  for (const page of pageResults(results)) {
    for (const violation of page?.violations || []) {
      const impact = IMPACTS.includes(violation.impact) ? violation.impact : 'unknown';
      const nodes = Array.isArray(violation.nodes) ? violation.nodes.length : 0;
      const id = violation.id || 'unknown-rule';
      const topic = violation.help || violation.description || id;
      const key = `${id}\u0000${topic}`;
      const existing = summary.impacts[impact].rules.get(key) || { id, topic, nodes: 0 };

      existing.nodes += nodes;
      summary.impacts[impact].rules.set(key, existing);
      summary.impacts[impact].nodes += nodes;
      summary.totalNodes += nodes;
      ruleIds.add(id);
    }

    for (const incomplete of page?.incomplete || []) {
      summary.incompleteNodes += Array.isArray(incomplete.nodes) ? incomplete.nodes.length : 0;
    }
  }

  summary.totalRules = ruleIds.size;
  return summary;
}

export function formatAxeSummary(summary) {
  const lines = [
    '',
    'axe-core automated accessibility findings',
    '--------------------------------------------',
  ];

  for (const impact of IMPACTS) {
    const bucket = summary.impacts[impact];
    lines.push(`${impact[0].toUpperCase()}${impact.slice(1)}: ${bucket.nodes}`);
    for (const rule of [...bucket.rules.values()].sort((a, b) => a.id.localeCompare(b.id))) {
      lines.push(`  - ${rule.topic} (${rule.id}): ${rule.nodes}`);
    }
  }

  lines.push(
    `Total: ${summary.totalNodes} affected element(s) across ${summary.totalRules} violating rule(s)`,
    `Incomplete/manual review: ${summary.incompleteNodes} affected element(s)`,
    `Report: ${REPORT_DISPLAY_PATH}`,
    'Automated findings are informational and do not fail the build.',
    `Reminder: perform the manual checks and complete ${SIGNOFF_PATH}.`,
    ''
  );

  return lines.join('\n');
}

function spawnWithOutput(executable, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, args, {
      cwd: PROJECT_ROOT,
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

function runAxeCli(url, chromedriverPath = null) {
  const executable = process.platform === 'win32' ? 'axe.cmd' : 'axe';
  const args = [
    ...url.split(','),
    '--stdout',
    '--tags',
    AXE_TAGS,
    '--timeout',
    '30',
    '--load-delay',
    '1200',
  ];
  if (chromedriverPath) args.push('--chromedriver-path', chromedriverPath);

  return spawnWithOutput(executable, args);
}

async function resolveMatchingChromedriver() {
  const platformDir = process.platform === 'darwin'
    ? 'macos'
    : process.platform === 'win32'
      ? 'windows'
      : 'linux';
  const executableName = process.platform === 'win32' ? 'selenium-manager.exe' : 'selenium-manager';
  const executable = resolve(
    PROJECT_ROOT,
    'node_modules',
    'selenium-webdriver',
    'bin',
    platformDir,
    executableName
  );
  const cachePath = resolve(PROJECT_ROOT, 'node_modules', '.cache', 'selenium');
  await mkdir(cachePath, { recursive: true });
  const outcome = await spawnWithOutput(executable, [
    '--browser',
    'chrome',
    '--avoid-browser-download',
    '--avoid-stats',
    '--skip-driver-in-path',
    '--cache-path',
    cachePath,
    '--timeout',
    '30',
    '--output',
    'json',
  ]);

  let managerResult;
  try {
    managerResult = JSON.parse(outcome.stdout);
  } catch {
    throw new Error(outcome.stderr.trim() || 'Selenium Manager returned invalid output.');
  }
  const driverPath = managerResult?.result?.driver_path;
  if (outcome.code !== 0 || !driverPath) {
    throw new Error(managerResult?.result?.message || outcome.stderr.trim() || 'No matching ChromeDriver was found.');
  }
  return driverPath;
}

async function saveJson(value) {
  await mkdir(dirname(REPORT_PATH), { recursive: true });
  await writeFile(REPORT_PATH, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function errorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(ANSI_ESCAPE, '');
}

async function saveAuditError(error, auditUrl = null) {
  await saveJson({
    status: 'error',
    generatedAt: new Date().toISOString(),
    auditUrl,
    message: errorMessage(error),
  });
}

export async function runAxeReport() {
  let server;
  let auditUrl = null;

  try {
    server = await createServer({
      configFile: resolve(PROJECT_ROOT, 'vite.config.js'),
      mode: 'a11y',
      logLevel: 'silent',
      server: {
        host: '127.0.0.1',
        port: 0,
        strictPort: false,
        open: false,
      },
    });
    await server.listen();

    const address = server.httpServer?.address();
    if (!address || typeof address === 'string') {
      throw new Error('Vite did not expose a local audit port.');
    }
    const origin = `http://127.0.0.1:${address.port}/`;
    // Audit every page (src/*.html, minus _drafts), not just the homepage
    auditUrl = glob
      .sync('src/*.html', { cwd: PROJECT_ROOT, ignore: 'src/_*.html' })
      .map((file) => basename(file, '.html'))
      .sort()
      .map((name) => origin + (name === 'index' ? '' : name))
      .join(',');

    let outcome = await runAxeCli(auditUrl);
    const mismatch = `${outcome.stdout}\n${outcome.stderr}`.includes('This version of ChromeDriver only supports');
    if (outcome.code !== 0 && mismatch) {
      const chromedriverPath = await resolveMatchingChromedriver();
      outcome = await runAxeCli(auditUrl, chromedriverPath);
    }
    if (outcome.code !== 0) {
      throw new Error(outcome.stderr.trim() || `axe CLI exited with code ${outcome.code}.`);
    }

    let results;
    try {
      const jsonStart = outcome.stdout.search(/^[\[{]/m);
      if (jsonStart === -1) throw new Error('No JSON payload found.');
      results = JSON.parse(outcome.stdout.slice(jsonStart));
    } catch {
      const outputPreview = outcome.stdout.trim().slice(0, 500).replace(ANSI_ESCAPE, '');
      throw new Error(`axe CLI returned output that was not valid JSON. Output: ${outputPreview || '(empty)'}`);
    }

    await saveJson(results);
    console.log(formatAxeSummary(summarizeAxeResults(results)));
  } catch (error) {
    try {
      await saveAuditError(error, auditUrl);
    } catch (writeError) {
      console.warn(`Unable to write ${REPORT_DISPLAY_PATH}: ${errorMessage(writeError)}`);
    }

    console.warn('\naxe-core audit could not be completed (build remains successful).');
    console.warn(`Reason: ${errorMessage(error)}`);
    console.warn(`Report: ${REPORT_DISPLAY_PATH}`);
    console.warn(`Reminder: perform the manual checks and complete ${SIGNOFF_PATH}.\n`);
  } finally {
    if (server) {
      try {
        await server.close();
      } catch (closeError) {
        console.warn(`Unable to close the temporary axe server cleanly: ${errorMessage(closeError)}`);
      }
    }
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  await runAxeReport();
}
