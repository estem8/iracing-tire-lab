/**
 * Proves the package works the way a consumer would use it: build, pack,
 * install the tarball into an empty project, then run it as JavaScript and
 * typecheck it as TypeScript. Slow and touches npm, so it is not part of
 * `npm test`; CI runs it.
 *   npm run check:package
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = process.cwd();
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const run = (cmd: string, args: string[], cwd = root): string =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: 'pipe' });
const fail = (message: string): never => {
  console.error(`check:package FAILED: ${message}`);
  process.exit(1);
};

run(npm, ['run', 'build', '--silent']);

// 1. What goes into the tarball: the build and the licences, nothing else.
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'tire-lab-pkg-'));
const packed = JSON.parse(
  run(npm, ['pack', '--json', '--pack-destination', work]),
) as { filename: string; files: { path: string }[] }[];
const tarball = path.join(work, packed[0].filename);
const stray = packed[0].files
  .map((f) => f.path)
  .filter(
    (p) =>
      !/^(dist\/|LICENSE$|NOTICE$|README\.md$|package\.json$)/.test(p) ||
      /\.(ibt|irdt)$/i.test(p),
  );
if (stray.length > 0)
  fail(`unexpected files in the tarball: ${stray.join(', ')}`);

// 2. The pure model must not reach for I/O: relative imports that stay inside dist/model.
const modelDir = path.join(root, 'dist/model');
const jsFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return jsFiles(full);
    return e.name.endsWith('.js') ? [full] : [];
  });
for (const file of jsFiles(modelDir)) {
  const text = fs.readFileSync(file, 'utf8');
  for (const m of text.matchAll(
    /^\s*(?:import|export)[^'"\n]*from\s*['"]([^'"]+)['"]/gm,
  )) {
    const inside =
      m[1].startsWith('.') &&
      path.resolve(path.dirname(file), m[1]).startsWith(modelDir + path.sep);
    if (!inside) fail(`${path.relative(root, file)} imports ${m[1]}`);
  }
}

// 3. Install into an empty project.
const app = path.join(work, 'app');
fs.mkdirSync(app);
fs.writeFileSync(
  path.join(app, 'package.json'),
  JSON.stringify({ name: 'consumer', private: true, type: 'module' }),
);
run(npm, ['install', '--offline', '--no-audit', '--no-fund', tarball], app);
// A consumer has @types/node of its own; reuse this repo's.
fs.mkdirSync(path.join(app, 'node_modules/@types'), { recursive: true });
fs.symlinkSync(
  path.join(root, 'node_modules/@types/node'),
  path.join(app, 'node_modules/@types/node'),
  'dir',
);

const usage = `
import { IbtFile, IbtVarType } from 'iracing-tire-lab/ibt';
import { applyMask, EMPTY_CAR, type TireModel } from 'iracing-tire-lab/model';
import { frames, replayModel, PRODUCTION_HZ } from 'iracing-tire-lab/replay';
import { buildChartData, renderChartHtml } from 'iracing-tire-lab/chart';
import { buildIbt } from 'iracing-tire-lab/testing';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'consumer-')), 'a.ibt');
fs.writeFileSync(file, buildIbt({
  yaml: 'WeekendInfo:\\n TrackName: t\\n',
  vars: [
    { name: 'SessionTick', type: IbtVarType.Int },
    { name: 'SessionTime', type: IbtVarType.Double },
    { name: 'LFtempCL', type: IbtVarType.Float },
    { name: 'LFtempCM', type: IbtVarType.Float },
    { name: 'LFtempCR', type: IbtVarType.Float },
  ],
  rows: Array.from({ length: 120 }, (_, i) => ({
    SessionTick: i, SessionTime: i / 60, LFtempCL: 60, LFtempCM: 61, LFtempCR: 62,
  })),
}));

const model: TireModel = {
  reset() {},
  step(s) {
    const c = s.wheels.lf.carcass;
    return { carcass: c ? { lf: { kind: 'estimate', model: 'consumer', value: c[1] } } : {} };
  },
};
const ibt = IbtFile.open(file);
const steps = [...replayModel(model, frames(ibt), { hz: PRODUCTION_HZ, mask: 'live' })];
const page = renderChartHtml(buildChartData(ibt, { channels: ['LFtempCM'] }));
ibt.close();
const masked = applyMask(
  { t: 0, dt: 0, speed: null, car: EMPTY_CAR, wheels: {} as never },
  'all'
);
console.log(JSON.stringify({ steps: steps.length, last: steps[steps.length - 1].output, masked: masked.speed, page: page.startsWith('<!doctype html>') && page.includes('LFtempCM') }));
`;
fs.writeFileSync(path.join(app, 'main.ts'), usage);

// 4. Typecheck as a TypeScript consumer.
fs.writeFileSync(
  path.join(app, 'tsconfig.json'),
  JSON.stringify({
    compilerOptions: {
      module: 'nodenext',
      moduleResolution: 'nodenext',
      target: 'ES2023',
      strict: true,
      noEmit: true,
      types: ['node'],
    },
    include: ['main.ts'],
  }),
);
try {
  run(
    'node',
    [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json'],
    app,
  );
} catch (e) {
  fail(
    `consumer does not typecheck:\n${(e as { stdout?: string }).stdout ?? e}`,
  );
}

// 5. Run as JavaScript: compile the consumer file, then execute it.
run(
  'node',
  [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    '-p',
    'tsconfig.json',
    '--noEmit',
    'false',
    '--outDir',
    'out',
  ],
  app,
);
const out = run('node', ['out/main.js'], app).trim();
const result = JSON.parse(out) as {
  steps: number;
  last: { carcass: { lf?: { value: number } } };
  page: boolean;
};
if (
  result.steps !== 30 ||
  result.last.carcass.lf?.value !== 61 ||
  !result.page
) {
  fail(`unexpected consumer output: ${out}`);
}

// 6. Only the documented entry points resolve; the sources are not importable.
const probe = `
const bad = [];
for (const spec of ['iracing-tire-lab/src/ibt/reader.ts', 'iracing-tire-lab/dist/ibt/reader.js']) {
  try { await import(spec); bad.push(spec); } catch (e) { if (e.code !== 'ERR_PACKAGE_PATH_NOT_EXPORTED') bad.push(spec + ' ' + e.code); }
}
console.log(JSON.stringify(bad));
`;
fs.writeFileSync(path.join(app, 'probe.mjs'), probe);
const leaked = JSON.parse(run('node', ['probe.mjs'], app)) as string[];
if (leaked.length > 0) fail(`deep imports are reachable: ${leaked.join(', ')}`);

// 7. The CLI is installed as a command.
const help = (() => {
  try {
    return run(path.join(app, 'node_modules/.bin/tire-lab'), [], app);
  } catch (e) {
    return String((e as { stderr?: string }).stderr ?? '');
  }
})();
if (!help.includes('usage:'))
  fail('the tire-lab command did not print its usage');

console.log(
  `check:package ok: ${packed[0].files.length} files in ${packed[0].filename}; ` +
    'JS run, TS typecheck, entry points and CLI verified',
);
fs.rmSync(work, { recursive: true, force: true });
