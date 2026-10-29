/**
 * Makes tests/golden/processor.json: the real irdashies TireProcessor run over
 * tests/golden/stimulus.ts. It needs an irdashies checkout and esbuild, neither
 * of which is a dependency of this repo:
 *
 *   node scripts/goldenProcessor.cjs --source <irdashies checkout> \
 *        --esbuild <path to the esbuild package> --out tests/golden/processor.json
 *
 * Check the checkout is at the commit in src/model/irdashies/PROVENANCE.json
 * first; the script prints the commit it ran against.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const flag = (name) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const source = flag('--source');
const esbuildPath = flag('--esbuild');
const out = flag('--out') ?? 'tests/golden/processor.json';
if (!source || !esbuildPath) {
  console.error(
    'usage: goldenProcessor.cjs --source <checkout> --esbuild <package path> [--out file]',
  );
  process.exit(2);
}
const { build } = require(path.resolve(esbuildPath));
const commit = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], {
  encoding: 'utf8',
}).trim();
const pinned = JSON.parse(
  fs.readFileSync('src/model/irdashies/PROVENANCE.json', 'utf8'),
).commit;
if (commit !== pinned) {
  console.error(
    `the checkout is at ${commit}, the lab copy is pinned to ${pinned}; check that one out`,
  );
  process.exit(1);
}
const stimulus = path.resolve('tests/golden/stimulus.ts');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'golden-'));
const entry = path.join(dir, 'entry.ts');
const bundle = path.join(dir, 'entry.cjs');
fs.writeFileSync(
  entry,
  `
import { TireProcessor } from ${JSON.stringify(path.resolve(source, 'src/app/processors/TireProcessor'))};
import { stimulus, CARS } from ${JSON.stringify(stimulus)};
const out: Record<string, unknown> = {};
for (const car of CARS) {
  const p = new TireProcessor();
  p.init({ DriverInfo: { DriverCarIdx: 0, Drivers: [{ CarIdx: 0, CarPath: car }] }, WeekendInfo: { TrackName: 'synthetic', SubSessionID: 1 } } as never);
  const rows: unknown[] = [];
  for (const f of stimulus()) {
    const frame: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(f)) frame[k] = { value: [v] };
    p.onFrame(frame as never);
    const corners = p.snapshot().corners;
    rows.push({
      t: f.SessionTime,
      corners: Object.fromEntries(
        Object.entries(corners).map(([k, v]) => [k, { temp: v!.temp, tempReal: v!.tempReal, disc: v!.disc, tempEstimated: v!.tempEstimated }]),
      ),
    });
  }
  out[car] = rows;
}
process.stdout.write(JSON.stringify(out));
`,
);
// The processor logs through electron-only modules; the run needs neither.
const stubs = {
  tyreLog:
    'export const tyreLog=()=>undefined;export const startTyreRun=()=>undefined;export const tyreFile=()=>undefined;export const stamp=()=>"";',
  logger:
    'const n=()=>undefined;export default {warn:n,error:n,info:n,debug:n,log:n,verbose:n};',
};
build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  outfile: bundle,
  logLevel: 'error',
  plugins: [
    {
      name: 'stub',
      setup(b) {
        for (const [name, contents] of Object.entries(stubs)) {
          b.onResolve({ filter: new RegExp(`/${name}$`) }, () => ({
            path: name,
            namespace: 'stub',
          }));
          b.onLoad(
            { filter: new RegExp(`^${name}$`), namespace: 'stub' },
            () => ({ contents, loader: 'ts' }),
          );
        }
      },
    },
  ],
}).then(() => {
  fs.writeFileSync(
    out,
    execFileSync('node', [bundle], { encoding: 'utf8', maxBuffer: 1 << 28 }),
  );
  fs.rmSync(dir, { recursive: true });
  console.log(`wrote ${out} from irdashies ${commit}`);
});
