/**
 * Copies the tire physics out of an irdashies checkout into src/model/irdashies/
 * and later checks that the copy has not drifted from it.
 *
 *   node scripts/vendorIrdashies.ts --source <git checkout> --commit <sha> --write
 *   node scripts/vendorIrdashies.ts --source <git checkout> --commit <sha> --check
 *
 * Files are read with `git show <commit>:<path>`, so the working tree of the
 * checkout does not matter. Only the transform below is applied; a vendored
 * file is never edited by hand (tests/vendor.test.ts compares it to the hash
 * recorded here). To change one, change it in the one place that owns it, then
 * run --write again.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const REPO = 'https://github.com/estem8/irdashies';
const OUT_DIR = 'src/model/irdashies';

/**
 * [path in irdashies, file name here]. The pure physics, nothing that touches electron or fs.
 * TireSurfaceModel.ts is not here: it was forked into src/model/surface/ so its constants can
 * be changed, and is the lab's own file now.
 */
export const FILES: readonly (readonly [string, string])[] = [
  ['src/app/processors/TireThermalModel.ts', 'TireThermalModel.ts'],
  ['src/app/processors/tireProfiles.ts', 'tireProfiles.ts'],
  ['src/app/processors/YawGrip.ts', 'YawGrip.ts'],
  ['src/app/processors/tireCalibration.ts', 'tireCalibration.ts'],
];

const sha256 = (text: string) =>
  crypto.createHash('sha256').update(text).digest('hex');

const replaceOnce = (text: string, from: string, to: string): string => {
  if (text.split(from).length !== 2) {
    throw new Error(`expected exactly one occurrence of: ${from}`);
  }
  return text.replace(from, to);
};

/**
 * The only changes made to the upstream text:
 *  1. the shared types come from ../types.ts, not the app's @irdashies/types;
 *  2. relative imports carry their .ts extension (Node runs the source);
 *  3. a constructor parameter property becomes a field (not erasable syntax);
 *  4. a header that says where the file came from.
 * Anything left that would not run here makes the transform throw.
 */
export const transform = (
  upstream: string,
  from: string,
  commit: string,
): string => {
  let text = upstream
    .replace(
      /import type \{ TireCorner \} from '@irdashies\/types';/g,
      "import type { Corner as TireCorner } from '../types.ts';",
    )
    .replace(/from '\.\/(\w+)'/g, "from './$1.ts'");
  if (text.includes('constructor(private params: SurfaceParams) {}')) {
    text = replaceOnce(
      text,
      '  constructor(private params: SurfaceParams) {}',
      '  private params: SurfaceParams;\n\n  constructor(params: SurfaceParams) {\n    this.params = params;\n  }',
    );
  }
  if (text.includes('@irdashies/')) {
    throw new Error(`${from}: still imports from @irdashies/`);
  }
  if (/(?:from|import)\s*['"]\.{1,2}\/[^'"]*(?<!\.ts)['"]/.test(text)) {
    throw new Error(`${from}: a relative import without .ts`);
  }
  if (
    /\bconstructor\([^)]*\b(?:private|public|protected|readonly)\b/.test(text)
  ) {
    throw new Error(`${from}: a constructor parameter property`);
  }
  const header =
    `/**\n * Vendored from irdashies (MIT, see NOTICE): ${from}\n` +
    ` * at ${commit}. Do not edit here; see scripts/vendorIrdashies.ts.\n */\n`;
  return header + text;
};

const git = (source: string, args: string[]): string =>
  execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' });

const flag = (args: string[], name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const main = (): void => {
  const args = process.argv.slice(2);
  const source = flag(args, '--source');
  const commit = flag(args, '--commit');
  const write = args.includes('--write');
  const check = args.includes('--check');
  if (!source || !commit || write === check || !/^[0-9a-f]{40}$/.test(commit)) {
    console.error(
      'usage: vendorIrdashies.ts --source <checkout> --commit <40-hex sha> (--write | --check)',
    );
    process.exit(2);
  }

  const results = FILES.map(([from, name]) => {
    const upstream = git(source, ['show', `${commit}:${from}`]);
    return { from, name, upstream, text: transform(upstream, from, commit) };
  });

  if (write) {
    fs.mkdirSync(OUT_DIR, { recursive: true });
    for (const r of results)
      fs.writeFileSync(path.join(OUT_DIR, r.name), r.text);
    fs.writeFileSync(
      path.join(OUT_DIR, 'PROVENANCE.json'),
      JSON.stringify(
        {
          repo: REPO,
          branch: 'feat/tire-widget',
          commit,
          files: results.map((r) => ({
            from: r.from,
            to: `${OUT_DIR}/${r.name}`,
            upstreamSha256: sha256(r.upstream),
            localSha256: sha256(r.text),
          })),
        },
        null,
        2,
      ) + '\n',
    );
    console.log(`vendored ${results.length} files at ${commit}`);
    return;
  }

  const drifted = results.filter((r) => {
    const local = path.join(OUT_DIR, r.name);
    return !fs.existsSync(local) || fs.readFileSync(local, 'utf8') !== r.text;
  });
  if (drifted.length > 0) {
    console.error(
      `drift from irdashies at ${commit}:\n` +
        drifted.map((r) => `  ${r.name}`).join('\n') +
        '\nre-vendor with --write, after deciding which side is right',
    );
    process.exit(1);
  }
  console.log(`no drift: ${results.length} files match ${commit}`);
};

import { fileURLToPath } from 'node:url';
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
