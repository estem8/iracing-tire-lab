#!/usr/bin/env node
/**
 * iracing-tire-lab CLI.
 *   inspect   <file.ibt>                          channels, units, session summary
 *   export    <file.ibt> --channels A,B --out x.csv [--stride N]
 *   chart     <file.ibt> --out chart.html [--channels A,B] [--max-points N]
 *   anonymize <in.ibt> <out.ibt>                  best-effort same-length redaction of personal fields
 */
import fs from 'node:fs';
import path from 'node:path';
import { isSea } from 'node:sea';
import { formatValue, readVarValue } from '../ibt/binary.ts';
import {
  addModelSeries,
  buildChartData,
  renderChartHtml,
} from '../chart/index.ts';
import { parseColumn } from '../ibt/column.ts';
import { IbtError } from '../ibt/errors.ts';
import { IbtFile } from '../ibt/reader.ts';
import { anonymizeSessionYaml, summarizeSession } from '../ibt/session.ts';
import {
  formatScore,
  parseReference,
  score,
  scoreSteps,
} from '../metrics/index.ts';
import type { InputMask } from '../model/mask.ts';
import { OverlayModel } from '../model/overlayModel.ts';
import { startServer } from '../app/server.ts';
import { defaultSystem, type TelemetryCommand } from '../app/system.ts';
import { renderFilePage, renderLapPage } from '../app/viewFile.ts';
import type { CarSample, Corner, TireSample } from '../model/types.ts';
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
  tire-lab chart <file.ibt> --out <chart.html> [--channels A,B,C] [--max-points 5000 | --stride N] [--model [--car <car path>] [--hz ${PRODUCTION_HZ}] [--arrival-hz ${APP_ARRIVAL_HZ}] [--mask live|all]]
  tire-lab score <file.ibt> --reference <reference.json> [--car <car path>] [--max-gap 1] [--hz ${PRODUCTION_HZ}] [--arrival-hz ${APP_ARRIVAL_HZ}] [--mask live|all] [--json]
  tire-lab anonymize <in.ibt> <out.ibt>
  tire-lab laps <file.ibt>                                 the laps of a recording, with lap times
  tire-lab lapchart <file.ibt> --lap N [--compare M] [--out page.html] [--no-open]   one lap, or two, by distance
  tire-lab view <file.ibt> [--out page.html] [--no-open]   chart with the model, opened in the browser
  tire-lab app [--no-open] [--port N] [--self-test]        local page: open files, switch iRacing's recording
  tire-lab telemetry <on|off>                              tell iRacing to start or stop recording (Windows)`;

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
  ...CAR_COLUMNS.map(([name]) => name),
  ...CORNER_ORDER.flatMap((c) => [
    ...['L', 'M', 'R'].map((z) => `${c}.carcass${z}`),
    ...['L', 'M', 'R'].map((z) => `${c}.surface${z}`),
    ...['L', 'M', 'R'].map((z) => `${c}.wear${z}`),
    `${c}.coldKpa`,
    `${c}.hotKpa`,
    `${c}.shockDeflM`,
  ]),
];
const flagCell = (v: boolean | null): number | null =>
  v === null ? null : v ? 1 : 0;
/** Car-level columns of the sample CSV: the header and how to read each. */
const CAR_COLUMNS: [string, (c: CarSample) => number | null][] = [
  ['sessionNum', (c) => c.sessionNum],
  ['isOnTrack', (c) => flagCell(c.isOnTrack)],
  ['onPitRoad', (c) => flagCell(c.onPitRoad)],
  ['pitstopActive', (c) => flagCell(c.pitstopActive)],
  ['pitSvFlags', (c) => c.pitSvFlags],
  ['velocityX', (c) => c.velocityX],
  ['velocityY', (c) => c.velocityY],
  ['yawRate', (c) => c.yawRate],
  ['steeringWheelAngle', (c) => c.steeringWheelAngle],
  ['steeringWheelTorque', (c) => c.steeringWheelTorque],
  ['latAccel', (c) => c.latAccel],
  ['longAccel', (c) => c.longAccel],
  ['vertAccel', (c) => c.vertAccel],
  ['throttle', (c) => c.throttle],
  ['brake', (c) => c.brake],
  ['brakeAbsActive', (c) => flagCell(c.brakeAbsActive)],
  ['dcBrakeBias', (c) => c.dcBrakeBias],
  ['airTemp', (c) => c.airTemp],
  ['trackTemp', (c) => c.trackTemp],
  ['trackTempCrew', (c) => c.trackTempCrew],
  ['lapCompleted', (c) => c.lapCompleted],
  ['lapDistPct', (c) => c.lapDistPct],
];
const cell = (v: number | null): string => (v === null ? '' : String(v));
const sampleCells = (s: TireSample): string[] => [
  String(s.t),
  String(s.dt),
  cell(s.speed),
  ...CAR_COLUMNS.map(([, read]) => cell(read(s.car))),
  ...CORNER_ORDER.flatMap((c) => {
    const w = s.wheels[c];
    return [
      ...[0, 1, 2].map((i) => cell(w.carcass?.[i] ?? null)),
      ...[0, 1, 2].map((i) => cell(w.surface?.[i] ?? null)),
      ...[0, 1, 2].map((i) => cell(w.treadRemaining?.[i] ?? null)),
      cell(w.coldPressureKpa),
      cell(w.hotPressureKpa),
      cell(w.shockDeflM),
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

/** Runs the overlay's physics over a recording and prints its error against a reference file. */
const scoreCommand = (args: string[]): void => {
  const referencePath = flag(args, '--reference');
  const hz = Number(flag(args, '--hz') ?? PRODUCTION_HZ);
  const arrivalHz = Number(flag(args, '--arrival-hz') ?? APP_ARRIVAL_HZ);
  const maxGapS = Number(flag(args, '--max-gap') ?? 1);
  const mask = (flag(args, '--mask') ?? 'live') as InputMask;
  if (
    !referencePath ||
    !(hz > 0) ||
    !(arrivalHz > 0) ||
    !(maxGapS >= 0) ||
    (mask !== 'live' && mask !== 'all')
  ) {
    throw new Error(USAGE);
  }
  const reference = parseReference(fs.readFileSync(referencePath, 'utf8'));
  const file = IbtFile.open(args[0]);
  try {
    const car =
      flag(args, '--car') ??
      reference.car ??
      summarizeSession(file.sessionYaml).carPath;
    const steps = scoreSteps(new OverlayModel(car), frames(file), {
      hz,
      arrivalHz,
      mask,
    });
    const result = score(steps, reference, { maxGapS });
    if (args.includes('--json')) {
      console.log(JSON.stringify({ car: car ?? null, ...result }, null, 2));
      return;
    }
    console.log(
      `model overlay-physics, car ${car ?? 'unknown (default profile)'}, ` +
        `${steps.length} steps (${arrivalHz} Hz arrival, ${hz} Hz tick, ${mask})`,
    );
    console.log(`reference: ${reference.source}`);
    console.log(formatScore(result));
  } finally {
    file.close();
  }
};

/** One HTML file with a chart per unit and a switch per series; open it in a browser. */
const chart = (args: string[]): void => {
  const out = flag(args, '--out');
  const channels = flag(args, '--channels')?.split(',').filter(Boolean);
  const maxPoints = flag(args, '--max-points');
  const stride = flag(args, '--stride');
  if (
    !out ||
    (maxPoints !== undefined && !(Number(maxPoints) >= 2)) ||
    (stride !== undefined &&
      !(Number.isInteger(Number(stride)) && Number(stride) >= 1))
  ) {
    throw new Error(USAGE);
  }
  const file = IbtFile.open(args[0]);
  try {
    let data = buildChartData(file, {
      channels,
      maxPoints: maxPoints === undefined ? undefined : Number(maxPoints),
      stride: stride === undefined ? undefined : Number(stride),
    });
    if (args.includes('--model')) {
      const hz = Number(flag(args, '--hz') ?? PRODUCTION_HZ);
      const arrivalHz = Number(flag(args, '--arrival-hz') ?? APP_ARRIVAL_HZ);
      const mask = (flag(args, '--mask') ?? 'live') as InputMask;
      if (!(hz > 0) || !(arrivalHz > 0) || (mask !== 'live' && mask !== 'all'))
        throw new Error(USAGE);
      const car =
        flag(args, '--car') ?? summarizeSession(file.sessionYaml).carPath;
      data = addModelSeries(
        data,
        scoreSteps(new OverlayModel(car), frames(file), {
          hz,
          arrivalHz,
          mask,
        }),
      );
    }
    fs.writeFileSync(out, renderChartHtml(data));
    console.log(
      `wrote ${out}: ${data.series.length} series, ${data.x.length} points (every ${data.stride} of ${data.records} records)`,
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

/** Lists the laps of a recording: number, time, and whether the lap is whole. */
const lapsCommand = (args: string[]): void => {
  const page = renderFilePage(args[0]);
  if (page.laps.length === 0) {
    console.log('No laps found: the file needs a LapDistPct channel.');
    return;
  }
  const times = page.laps.flatMap((l) => (l.timeS === null ? [] : [l.timeS]));
  const best = times.length > 0 ? Math.min(...times) : undefined;
  for (const l of page.laps) {
    const time =
      l.timeS === null
        ? l.complete
          ? ''
          : 'partial'
        : `${Math.floor(l.timeS / 60)}:${(l.timeS % 60).toFixed(3).padStart(6, '0')}`;
    console.log(
      `lap ${String(l.lap).padStart(3)}  ${time.padEnd(9)}${l.timeS !== null && l.timeS === best ? ' fastest' : ''}`,
    );
  }
};

/** One lap, or two to compare, by distance round the lap. */
const lapChartCommand = async (args: string[]): Promise<void> => {
  const lap = Number(flag(args, '--lap'));
  const withLap = flag(args, '--compare');
  if (
    !Number.isInteger(lap) ||
    (withLap !== undefined && !Number.isInteger(Number(withLap)))
  )
    throw new Error(USAGE);
  const file = args[0];
  const page = renderFilePage(file);
  const html = renderLapPage(
    file,
    page,
    lap,
    withLap === undefined ? undefined : Number(withLap),
  );
  const out =
    flag(args, '--out') ??
    path.join(
      path.dirname(file),
      `${path.basename(file).replace(/\.ibt$/i, '')}.lap${lap}${withLap === undefined ? '' : `-${withLap}`}.html`,
    );
  fs.writeFileSync(out, html);
  console.log(`wrote ${out}`);
  if (!args.includes('--no-open')) {
    try {
      await defaultSystem().openBrowser(out);
    } catch (e) {
      console.log(`Open the file yourself: ${(e as Error).message}`);
    }
  }
};

/** A recording's chart with the model, written next to it and opened in the browser. */
const view = async (args: string[]): Promise<void> => {
  const file = args[0];
  const out =
    flag(args, '--out') ??
    path.join(
      path.dirname(file),
      `${path.basename(file).replace(/\.ibt$/i, '')}.tire-lab.html`,
    );
  const page = renderFilePage(file);
  fs.writeFileSync(out, page.html);
  console.log(
    `wrote ${out} (${page.records} records${page.car ? `, ${page.car}` : ''})`,
  );
  if (page.note) console.log(page.note);
  if (!args.includes('--no-open')) {
    try {
      await defaultSystem().openBrowser(out);
    } catch (e) {
      console.log(`Open the file yourself: ${(e as Error).message}`);
    }
  }
};

/** The local page: open files, switch iRacing's telemetry recording. Runs until quit. */
const appCommand = async (args: string[]): Promise<void> => {
  const system = defaultSystem();
  const port = Number(flag(args, '--port') ?? 0);
  if (!Number.isInteger(port) || port < 0 || port > 65535)
    throw new Error(USAGE);
  let quit: () => void = () => undefined;
  const quitted = new Promise<void>((resolve) => (quit = resolve));
  const server = await startServer(system, { port, onQuit: () => quit() });
  if (args.includes('--self-test')) {
    // One request through the real server and system, for the build's own check.
    const res = await fetch(`http://127.0.0.1:${server.port}/api/status`, {
      headers: { 'x-token': server.token },
    });
    console.log(JSON.stringify({ status: res.status, ...(await res.json()) }));
    await server.close();
    return;
  }
  console.log(`Tire Lab is running at ${server.url}`);
  console.log('Close this window or press Ctrl+C to quit.');
  if (!args.includes('--no-open')) {
    try {
      await system.openBrowser(server.url);
    } catch {
      console.log('Open that address in a browser.');
    }
  }
  await quitted;
  await server.close();
};

/** Tells iRacing to start or stop writing its telemetry file. */
const telemetryCommand = async (args: string[]): Promise<void> => {
  const word = args[0];
  const command: TelemetryCommand | undefined =
    word === 'on' ? 'start' : word === 'off' ? 'stop' : undefined;
  if (!command) throw new Error(USAGE);
  await defaultSystem().telemetry(command);
  console.log(
    `sent: ${command}. iRacing records only while you are in the car; this cannot confirm it.`,
  );
};

const pause = (): Promise<void> =>
  process.stdin.isTTY
    ? new Promise((resolve) => {
        console.error('Press Enter to close.');
        process.stdin.once('data', () => resolve());
      })
    : Promise.resolve();

const main = async (): Promise<void> => {
  // A packaged executable also gets its own path as the first argument.
  const argv = process.argv.slice(2).filter((a) => a !== process.execPath);
  const [command, ...args] = argv;
  const packaged = isSea();
  try {
    // Double-clicked (no arguments) or started with only options: the app.
    if (packaged && (command === undefined || command.startsWith('--')))
      return await appCommand(argv);
    if (command && /\.ibt$/i.test(command) && fs.existsSync(command))
      return await view(argv);
    if (command === 'inspect' && args[0]) return inspect(args);
    if (command === 'export' && args[0]) return exportCsv(args);
    if (command === 'sample' && args[0]) return sample(args);
    if (command === 'chart' && args[0]) return chart(args);
    if (command === 'score' && args[0]) return scoreCommand(args);
    if (command === 'view' && args[0]) return await view(args);
    if (command === 'laps' && args[0]) return lapsCommand(args);
    if (command === 'lapchart' && args[0]) return await lapChartCommand(args);
    if (command === 'app') return await appCommand(args);
    if (command === 'telemetry') return await telemetryCommand(args);
    if (command === 'anonymize') return anonymize(args);
    console.error(USAGE);
    process.exitCode = 2;
  } catch (e) {
    console.error(
      e instanceof IbtError ? `${e.code}: ${e.message}` : (e as Error).message,
    );
    process.exitCode = 1;
  }
  // Double-clicked or dropped on: the window would vanish with the message.
  if (packaged && process.exitCode) await pause();
};

void main();
