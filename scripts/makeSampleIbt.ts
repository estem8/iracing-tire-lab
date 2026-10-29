/** Writes a small synthetic recording, for the executable's own check: node scripts/makeSampleIbt.ts <out.ibt> */
import fs from 'node:fs';
import { syntheticIbt } from '../tests/helpers/syntheticIbt.ts';
import { pickScript, telemetryScript } from '../src/app/system.ts';

const [out, scripts] = process.argv.slice(2);
if (!out) throw new Error('usage: makeSampleIbt.ts <out.ibt> [scripts folder]');
fs.writeFileSync(out, syntheticIbt(true));
if (scripts) {
  // The PowerShell the app runs, written out so CI can parse it.
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(`${scripts}/pick.ps1`, pickScript('C:\\Temp'));
  fs.writeFileSync(`${scripts}/start.ps1`, telemetryScript('start'));
  fs.writeFileSync(`${scripts}/stop.ps1`, telemetryScript('stop'));
}
