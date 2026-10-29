/**
 * Builds a single-file executable of the CLI and the app: the code bundled by
 * esbuild into one script, then injected into a copy of the running `node` as a
 * Node single executable application. On Windows the result is tire-lab.exe;
 * elsewhere it is a binary for that system (the CI test runs it).
 *
 *   node scripts/buildExe.ts            -> dist-exe/tire-lab(.exe)
 *
 * The executable is not signed, so Windows SmartScreen warns about it.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { build } from 'esbuild';

const OUT = 'dist-exe';
const SENTINEL = 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2';
const exeName = process.platform === 'win32' ? 'tire-lab.exe' : 'tire-lab';

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

await build({
  entryPoints: ['src/cli/index.ts'],
  outfile: path.join(OUT, 'tire-lab.cjs'),
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node24',
  legalComments: 'none',
  logLevel: 'warning',
});

const config = path.join(OUT, 'sea-config.json');
const blob = path.join(OUT, 'sea-prep.blob');
fs.writeFileSync(
  config,
  JSON.stringify({
    main: path.join(OUT, 'tire-lab.cjs'),
    output: blob,
    disableExperimentalSEAWarning: true,
  }),
);
execFileSync(process.execPath, ['--experimental-sea-config', config], {
  stdio: 'inherit',
});

const exe = path.join(OUT, exeName);
fs.copyFileSync(process.execPath, exe);
if (process.platform !== 'win32') fs.chmodSync(exe, 0o755);
execFileSync(
  process.execPath,
  [
    path.join('node_modules', 'postject', 'dist', 'cli.js'),
    exe,
    'NODE_SEA_BLOB',
    blob,
    '--sentinel-fuse',
    SENTINEL,
  ],
  { stdio: 'inherit' },
);

const size = (fs.statSync(exe).size / 1024 / 1024).toFixed(0);
console.log(`built ${exe} (${size} MB, node ${process.version})`);
