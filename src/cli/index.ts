#!/usr/bin/env node
/**
 * iracing-tire-lab CLI.
 *   inspect   <file.ibt>                          channels, units, session summary
 *   export    <file.ibt> --channels A,B --out x.csv [--stride N]
 *   anonymize <in.ibt> <out.ibt>                  best-effort same-length redaction of personal fields
 */
import fs from 'node:fs';
import { formatValue, readVarValue } from '../ibt/binary.ts';
import { IbtError } from '../ibt/errors.ts';
import { IbtFile } from '../ibt/reader.ts';
import { anonymizeSessionYaml, summarizeSession } from '../ibt/session.ts';
import type { InputMask } from '../model/mask.ts';
import type { Corner, TireSample } from '../model/types.ts';
import {
  APP_ARRIVAL_HZ,
  modelInputs,
  PRODUCTION_HZ,
} from '../replay/replay.ts';
import { frames } from '../replay/samples.ts';

const USAGE = `usage:
  tire-lab inspect <file.ibt> [--json | --session]
  tire-lab export <file.ibt> --channels A,B,C --out <file.csv> [--stride N]
  tire-lab sample <file.ibt> --out <file.csv> [--hz ${PRODUCTION_HZ}] [--arrival-hz ${APP_ARRIVAL_HZ}] [--mask live|all]
  tire-lab anonymize <in.ibt> <out.ibt>`;

const flag = (args: string[], name: string): string | undefined => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

const inspect = (args: string[]): void => {
  const file = IbtFile.open(args[0]);
  try {
    // The raw session text, to review by eye what a file still says about people.
    if (args.includes('--session')) {
      console.log(file.sessionYaml);
      return;
    }
    const session = summarizeSession(file.sessionYaml);
    if (args.includes('--json')) {
      console.log(
        JSON.stringify(
          {
            tickRate: file.header.tickRate,
            records: file.recordCount,
            session,
            channels: file.vars,
          },
          null,
          2,
        ),
      );
      return;
    }
    console.log(
      `tickRate ${file.header.tickRate} Hz, ${file.recordCount} records, ` +
        `${(file.recordCount / Math.max(1, file.header.tickRate)).toFixed(1)} s`,
    );
    console.log(`session ${JSON.stringify(session)}`);
    console.log(
      `${file.vars.length} channels (name, unit, count, description):`,
    );
    for (const v of file.vars) {
      console.log(`  ${v.name}\t${v.unit || '-'}\t${v.count}\t${v.desc}`);
    }
  } finally {
    file.close();
  }
};

/** Column names: `Name` for a scalar, `Name[i]` for one element of an array. */
const parseColumn = (spec: string): { name: string; index: number } => {
  const m = /^(.+)\[(\d+)\]$/.exec(spec);
  return m ? { name: m[1], index: Number(m[2]) } : { name: spec, index: 0 };
};

const exportCsv = (args: string[]): void => {
  const out = flag(args, '--out');
  const channels = flag(args, '--channels')?.split(',').filter(Boolean);
  const stride = Number(flag(args, '--stride') ?? 1);
  if (!out || !channels?.length || !Number.isInteger(stride) || stride < 1) {
    throw new Error(USAGE);
  }
  const file = IbtFile.open(args[0]);
  try {
    const columns = channels.map(parseColumn);
    const headers = file.require(columns.map((c) => c.name));
    const lines = [['record', ...channels].join(',')];
    for (let r = 0; r < file.recordCount; r += stride) {
      const rec = file.readRecord(r);
      const cells = headers.map((h, i) =>
        formatValue(readVarValue(rec, h, columns[i].index), h.type),
      );
      lines.push([String(r), ...cells].join(','));
    }
    fs.writeFileSync(out, lines.join('\n') + '\n');
    const meta = {
      source: 'iracing-tire-lab export',
      tickRate: file.header.tickRate,
      stride,
      session: summarizeSession(file.sessionYaml),
      channels: headers.map((h, i) => ({
        column: channels[i],
        unit: h.unit,
        desc: h.desc,
      })),
    };
    fs.writeFileSync(
      out.replace(/\.csv$/i, '') + '.meta.json',
      JSON.stringify(meta, null, 2) + '\n',
    );
    console.log(`wrote ${lines.length - 1} rows to ${out}`);
  } finally {
    file.close();
  }
};

const CORNER_ORDER: Corner[] = ['lf', 'rf', 'lr', 'rr'];

/** The CSV header and cells of one model input sample; null is an empty cell. */
const sampleColumns = (): string[] => [
  't',
  'dt',
  'speed',
  ...CORNER_ORDER.flatMap((c) => [
    ...['L', 'M', 'R'].map((z) => `${c}.carcass${z}`),
    ...['L', 'M', 'R'].map((z) => `${c}.surface${z}`),
    ...['L', 'M', 'R'].map((z) => `${c}.wear${z}`),
    `${c}.coldKpa`,
    `${c}.hotKpa`,
  ]),
];
const cell = (v: number | null): string => (v === null ? '' : String(v));
const sampleCells = (s: TireSample): string[] => [
  String(s.t),
  String(s.dt),
  cell(s.speed),
  ...CORNER_ORDER.flatMap((c) => {
    const w = s.wheels[c];
    return [
      ...[0, 1, 2].map((i) => cell(w.carcass?.[i] ?? null)),
      ...[0, 1, 2].map((i) => cell(w.surface?.[i] ?? null)),
      ...[0, 1, 2].map((i) => cell(w.treadRemaining?.[i] ?? null)),
      cell(w.coldPressureKpa),
      cell(w.hotPressureKpa),
    ];
  }),
];

/** Writes what a model would be given at the overlay's rate: the lab's input contract, as CSV. */
const sample = (args: string[]): void => {
  const out = flag(args, '--out');
  const hz = Number(flag(args, '--hz') ?? PRODUCTION_HZ);
  const arrivalHz = Number(flag(args, '--arrival-hz') ?? APP_ARRIVAL_HZ);
  const mask = (flag(args, '--mask') ?? 'live') as InputMask;
  if (
    !out ||
    !(hz > 0) ||
    !(arrivalHz > 0) ||
    (mask !== 'live' && mask !== 'all')
  ) {
    throw new Error(USAGE);
  }
  const file = IbtFile.open(args[0]);
  try {
    const lines = [sampleColumns().join(',')];
    for (const s of modelInputs(frames(file), { hz, arrivalHz, mask })) {
      lines.push(sampleCells(s).join(','));
    }
    fs.writeFileSync(out, lines.join('\n') + '\n');
    console.log(
      `wrote ${lines.length - 1} samples (${arrivalHz} Hz arrival, ${hz} Hz tick, ${mask}) to ${out}`,
    );
  } finally {
    file.close();
  }
};

const anonymize = (args: string[]): void => {
  const [input, output] = args;
  if (!input || !output) throw new Error(USAGE);
  const file = IbtFile.open(input);
  const { sessionInfoOffset, sessionInfoLen } = file.header;
  const redacted = Buffer.from(
    anonymizeSessionYaml(file.sessionYaml),
    'latin1',
  );
  file.close();
  // Streams would be needed for a multi-GB file; copyFile is fine, and the patch is in place.
  fs.copyFileSync(input, output);
  const fd = fs.openSync(output, 'r+');
  try {
    if (redacted.length > sessionInfoLen)
      throw new Error('redaction grew the YAML');
    fs.writeSync(fd, redacted, 0, redacted.length, sessionInfoOffset);
  } finally {
    fs.closeSync(fd);
  }
  console.log(`wrote ${output}`);
  console.error(
    'Best effort, not verified on real recordings: it only blanks known fields. ' +
      `Read the result before sharing it: tire-lab inspect ${output} --session`,
  );
};

const main = (): void => {
  const [command, ...args] = process.argv.slice(2);
  try {
    if (command === 'inspect' && args[0]) return inspect(args);
    if (command === 'export' && args[0]) return exportCsv(args);
    if (command === 'sample' && args[0]) return sample(args);
    if (command === 'anonymize') return anonymize(args);
    console.error(USAGE);
    process.exitCode = 2;
  } catch (e) {
    console.error(
      e instanceof IbtError ? `${e.code}: ${e.message}` : (e as Error).message,
    );
    process.exitCode = 1;
  }
};

main();
