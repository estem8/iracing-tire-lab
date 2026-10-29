/**
 * A problem report: what a user needs to send so that someone else can see the
 * same thing. The tire model integrates, so the temperature at a moment depends
 * on the whole run before it; the report therefore carries the model's inputs
 * from the start of the session to the moment, at the overlay's 15 Hz, as plain
 * numbers. It carries no session text (no names, ids or dates), no other
 * driver, and no file path. It does carry what the recording says about the
 * car and track (names, track length and temperatures, as the sim writes them)
 * and the name, unit and description of every channel the file has. Nothing is
 * sent anywhere: the user saves the file and decides who gets it.
 */
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { MODEL_VERSION } from '../model/irdashies/tireProfiles.ts';
import { OverlayModel } from '../model/overlayModel.ts';
import { EMPTY_CAR } from '../model/channels.ts';
import { resolveTuning, type TuningRequest } from '../model/tuning.ts';
import type { Corner, TireSample } from '../model/types.ts';
import { LAB_VERSION } from '../version.ts';
import type { FilePage } from './viewFile.ts';

export const KINDS = ['mismatch', 'channel', 'laps', 'bug'] as const;
export type ReportKind = (typeof KINDS)[number];
export const QUANTITIES = ['carcass', 'tread', 'pressure'] as const;
const CORNERS: readonly Corner[] = ['lf', 'rf', 'lr', 'rr'];
const SOURCES = ['dash', 'pit-reading', 'other'] as const;
const MAX_NOTE = 2000;
/** Seconds of the run after the moment that are kept, for context. */
const AFTER_S = 10;
const MAX_OBSERVED = 8;

export interface Observation {
  corner: Corner;
  quantity: (typeof QUANTITIES)[number];
  value: number;
  source: (typeof SOURCES)[number];
}

export interface ReportRequest {
  kind: ReportKind;
  /** Session time of the moment, s: the clock of the recording's SessionTime. */
  t: number;
  /** What the game showed at that moment. */
  observed?: Observation[];
  note?: string;
  /** The workbench settings in use, if any. */
  workbench?: TuningRequest;
}

/** One column of the series: where it lives in a sample and how many decimals it needs. */
interface Field {
  name: string;
  decimals: number;
}

const CAR_FLAGS = ['isOnTrack', 'onPitRoad', 'pitstopActive', 'brakeAbsActive'];
const TIRE_CHANGE = ['lf', 'rf', 'lr', 'rr', 'left', 'right'];
const CAR_NUMBERS = Object.keys(EMPTY_CAR).filter(
  (k) => k !== 'tireChange' && !CAR_FLAGS.includes(k),
);
const DECIMALS: Record<string, number> = {
  sessionNum: 0,
  pitSvFlags: 0,
  lapCompleted: 0,
  lapDistPct: 4,
  steeringWheelAngle: 4,
  yawRate: 4,
  velocityX: 3,
  velocityY: 3,
  airTemp: 2,
  trackTemp: 2,
  trackTempCrew: 2,
};

export const FIELDS: readonly Field[] = [
  { name: 'speed', decimals: 3 },
  ...CAR_NUMBERS.map((k) => ({ name: `car.${k}`, decimals: DECIMALS[k] ?? 3 })),
  ...CAR_FLAGS.map((k) => ({ name: `car.${k}`, decimals: 0 })),
  ...TIRE_CHANGE.map((k) => ({ name: `car.tireChange.${k}`, decimals: 0 })),
  ...CORNERS.flatMap((c) => [
    ...[0, 1, 2].map((z) => ({
      name: `wheels.${c}.carcass.${z}`,
      decimals: 2,
    })),
    ...[0, 1, 2].map((z) => ({
      name: `wheels.${c}.treadRemaining.${z}`,
      decimals: 4,
    })),
    { name: `wheels.${c}.coldPressureKpa`, decimals: 2 },
    { name: `wheels.${c}.hotPressureKpa`, decimals: 2 },
    { name: `wheels.${c}.shockDeflM`, decimals: 5 },
  ]),
];

const read = (sample: TireSample, name: string): number | null => {
  const parts = name.split('.');
  let v: unknown = sample;
  for (const p of parts) v = (v as Record<string, unknown> | null)?.[p];
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const emptySample = (t: number, dt: number): TireSample => ({
  t,
  dt,
  speed: null,
  car: JSON.parse(JSON.stringify(EMPTY_CAR)),
  wheels: Object.fromEntries(
    CORNERS.map((c) => [
      c,
      {
        carcass: null,
        surface: null,
        treadRemaining: null,
        coldPressureKpa: null,
        hotPressureKpa: null,
        shockDeflM: null,
      },
    ]),
  ) as TireSample['wheels'],
});

/** The sample a column set describes at row i (the inverse of the series). */
const rebuild = (
  fields: readonly string[],
  columns: (number | null)[][],
  t: number[],
  i: number,
): TireSample => {
  const sample = emptySample(t[i], i === 0 ? 0 : t[i] - t[i - 1]);
  const zones: Record<string, (number | null)[]> = {};
  fields.forEach((name, k) => {
    const v = columns[k][i];
    const parts = name.split('.');
    if (parts[0] === 'speed') sample.speed = v;
    else if (parts[0] === 'car' && parts[1] === 'tireChange')
      (sample.car.tireChange as Record<string, number | null>)[parts[2]] = v;
    else if (parts[0] === 'car') {
      const key = parts[1];
      (sample.car as unknown as Record<string, unknown>)[key] =
        CAR_FLAGS.includes(key) ? (v === null ? null : v === 1) : v;
    } else if (parts[0] === 'wheels') {
      const [, c, field, z] = parts;
      if (z !== undefined)
        (zones[`${c}.${field}`] ??= [null, null, null])[Number(z)] = v;
      else
        (sample.wheels[c as Corner] as unknown as Record<string, unknown>)[
          field
        ] = v;
    }
  });
  for (const [key, z] of Object.entries(zones)) {
    const [c, field] = key.split('.');
    (sample.wheels[c as Corner] as unknown as Record<string, unknown>)[field] =
      z.every((x) => x !== null) ? z : null;
  }
  return sample;
};

export interface Report {
  schema: 1;
  kind: ReportKind;
  tool: { lab: string; modelVersion: string; node: string; platform: string };
  /** The car and track as the recording names them: no personal fields. */
  session: FilePage['meta']['session'];
  car: string | null;
  file: { tickRate: number; records: number; durationS: number };
  /** Every channel the file has, so a missing one can be seen. */
  channels: FilePage['meta']['channels'];
  moment: { t: number };
  observed: Observation[];
  note: string;
  workbench: { values: Record<string, number>; off: string[] };
  /** What the unchanged model said at the moment, in this app. */
  modelAtMoment: Partial<
    Record<
      Corner,
      {
        carcass?: number;
        tread?: number;
        pressureKpa?: number;
        shown?: number[];
      }
    >
  >;
  series: {
    hz: number;
    from: number;
    to: number;
    count: number;
    /** Seconds, one per row. */
    t: number[];
    fields: string[];
    columns: (number | null)[][];
  };
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;

export class ReportError extends Error {}

/** Checks a request and returns a clean copy: numbers are numbers, text is bounded. */
const cleanRequest = (
  r: ReportRequest,
): Required<Omit<ReportRequest, 'workbench'>> & {
  workbench: TuningRequest;
} => {
  if (!KINDS.includes(r.kind))
    throw new ReportError(`kind must be one of ${KINDS.join(', ')}`);
  if (typeof r.t !== 'number' || !Number.isFinite(r.t) || r.t < 0)
    throw new ReportError('Give the session time of the moment, in seconds');
  const observed = (r.observed ?? [])
    .slice(0, MAX_OBSERVED)
    .map((o, i): Observation => {
      if (!CORNERS.includes(o.corner))
        throw new ReportError(
          `observed[${i}]: corner must be one of ${CORNERS.join(', ')}`,
        );
      if (!QUANTITIES.includes(o.quantity))
        throw new ReportError(
          `observed[${i}]: quantity must be one of ${QUANTITIES.join(', ')}`,
        );
      if (typeof o.value !== 'number' || !Number.isFinite(o.value))
        throw new ReportError(`observed[${i}]: value must be a number`);
      if (!SOURCES.includes(o.source))
        throw new ReportError(
          `observed[${i}]: source must be one of ${SOURCES.join(', ')}`,
        );
      return {
        corner: o.corner,
        quantity: o.quantity,
        value: o.value,
        source: o.source,
      };
    });
  const note = typeof r.note === 'string' ? r.note.slice(0, MAX_NOTE) : '';
  return { kind: r.kind, t: r.t, observed, note, workbench: r.workbench ?? {} };
};

export const buildReport = (page: FilePage, request: ReportRequest): Report => {
  const req = cleanRequest(request);
  const samples = page.samples;
  if (samples.length === 0)
    throw new ReportError(
      'The model could not run on this file, so there is no run to report',
    );
  // The run starts where the model last started over: the first sample of the session the moment is in.
  let end = samples.findIndex((s) => s.t > req.t + AFTER_S);
  if (end < 0) end = samples.length;
  let at = samples.findIndex((s) => s.t > req.t);
  at = (at < 0 ? samples.length : at) - 1;
  if (at < 0)
    throw new ReportError('That moment is before the recording starts');
  let start = Math.min(at, end - 1);
  const session = samples[start].car.sessionNum;
  while (start > 0 && samples[start - 1].car.sessionNum === session) start--;
  const rows = samples.slice(start, end);

  const columns = FIELDS.map((f) =>
    rows.map((s) => {
      const v = read(s, f.name);
      return v === null ? null : round(v, f.decimals);
    }),
  );
  const step = page.steps[Math.min(at, page.steps.length - 1)];
  const modelAtMoment: Report['modelAtMoment'] = {};
  for (const c of CORNERS) {
    const carcass = step?.output.carcass[c]?.value;
    const tread = step?.output.tread?.[c]?.value;
    const pressure = step?.output.pressure?.[c]?.kpa;
    const shown = step?.output.shown?.[c]?.value;
    if ([carcass, tread, pressure, shown].some((v) => v !== undefined))
      modelAtMoment[c] = {
        ...(carcass !== undefined && { carcass: round(carcass, 2) }),
        ...(tread !== undefined && { tread: round(tread, 2) }),
        ...(pressure !== undefined && { pressureKpa: round(pressure, 1) }),
        ...(shown !== undefined && { shown: shown.map((x) => round(x, 2)) }),
      };
  }
  const tuning = resolveTuning(page.car, req.workbench);
  return {
    schema: 1,
    kind: req.kind,
    tool: {
      lab: LAB_VERSION,
      modelVersion: MODEL_VERSION,
      node: process.version,
      platform: process.platform,
    },
    session: page.meta.session,
    car: page.car ?? null,
    file: page.meta.file,
    channels: page.meta.channels,
    moment: { t: req.t },
    observed: req.observed,
    note: req.note,
    workbench: { values: { ...tuning }, off: [...(req.workbench.off ?? [])] },
    modelAtMoment,
    series: {
      hz: 15,
      from: round(rows[0].t, 3),
      to: round(rows[rows.length - 1].t, 3),
      count: rows.length,
      t: rows.map((s) => round(s.t, 3)),
      fields: FIELDS.map((f) => f.name),
      columns,
    },
  };
};

/** The report as it is saved: JSON, gzipped. */
export const serializeReport = (
  report: Report,
): { gz: Buffer; rawBytes: number } => {
  const raw = Buffer.from(JSON.stringify(report), 'utf8');
  return { gz: zlib.gzipSync(raw, { level: 9 }), rawBytes: raw.length };
};

/** A fingerprint of the saved bytes, so Save can refuse a file that is not the one previewed. */
export const digestOf = (gz: Buffer): string =>
  crypto.createHash('sha256').update(gz).digest('hex');

/** What the user is shown before saving: everything except the long series, which is described. */
export const previewOf = (report: Report): Record<string, unknown> => {
  const { series, channels, ...rest } = report;
  return {
    ...rest,
    channels: channels.map(
      (c) =>
        `${c.name}${c.unit ? ` [${c.unit}]` : ''}${c.count > 1 ? ` x${c.count}` : ''}${c.desc ? ` - ${c.desc}` : ''}`,
    ),
    series: {
      hz: series.hz,
      rows: series.count,
      sessionTimeFrom: series.from,
      sessionTimeTo: series.to,
      numbers: `${series.fields.length} columns of the model's inputs: speed, the car's accelerations, pedals, steering, yaw, air and track temperature, flags, and per tire the three carcass and three tread readings, pressures and shock travel. No driver names, ids, iRating or dates.`,
    },
  };
};

const MAX_REPORT_BYTES = 256 * 1024 * 1024;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Control characters out of text that will be printed, so a report cannot rewrite a terminal. */
export const plain = (v: unknown): string =>
  String(v ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

/** A report from someone else is read as untrusted: bounded, checked field by field. */
export const readReport = (
  bytes: Buffer,
  maxBytes = MAX_REPORT_BYTES,
): Report => {
  let raw: unknown;
  try {
    const text =
      bytes[0] === 0x1f && bytes[1] === 0x8b
        ? zlib.gunzipSync(bytes, { maxOutputLength: maxBytes }).toString('utf8')
        : bytes.length > maxBytes
          ? ''
          : bytes.toString('utf8');
    raw = JSON.parse(text);
  } catch {
    throw new ReportError(
      'That is not a report file (or it is larger than 256 MB unpacked)',
    );
  }
  if (!isObject(raw) || raw.schema !== 1)
    throw new ReportError('Unknown report version');
  const report = raw as unknown as Report;
  const s = report.series;
  if (
    !isObject(s) ||
    !Array.isArray(s.t) ||
    !Array.isArray(s.fields) ||
    !Array.isArray(s.columns) ||
    s.columns.length !== s.fields.length ||
    s.columns.some((c) => !Array.isArray(c) || c.length !== s.t.length)
  )
    throw new ReportError('The series of the report is malformed');
  if (
    s.t.length === 0 ||
    s.t.some((x) => typeof x !== 'number' || !Number.isFinite(x))
  )
    throw new ReportError('The series of the report is malformed');
  if (
    s.columns.some((c) =>
      c.some(
        (x) => x !== null && (typeof x !== 'number' || !Number.isFinite(x)),
      ),
    )
  )
    throw new ReportError('The series of the report is malformed');
  const known = new Set(FIELDS.map((f) => f.name));
  if (s.fields.some((f) => !known.has(f)))
    throw new ReportError('The report has a column this version does not know');
  if (!KINDS.includes(report.kind))
    throw new ReportError('The report has an unknown kind');
  if (
    !isObject(report.moment) ||
    typeof report.moment.t !== 'number' ||
    !Number.isFinite(report.moment.t)
  )
    throw new ReportError('The report has no moment');
  if (
    !isObject(report.tool) ||
    !isObject(report.file) ||
    !isObject(report.session)
  )
    throw new ReportError('The report is incomplete');
  if (report.car !== null && typeof report.car !== 'string')
    throw new ReportError('The report has a bad car');
  if (!Array.isArray(report.observed))
    throw new ReportError('The report has bad values from the game');
  report.observed = report.observed.slice(0, MAX_OBSERVED).map((o, i) => {
    try {
      return cleanRequest({
        kind: report.kind,
        t: report.moment.t,
        observed: [o],
      }).observed[0];
    } catch {
      throw new ReportError(
        `The game value ${i + 1} in the report is malformed`,
      );
    }
  });
  report.note =
    typeof report.note === 'string' ? report.note.slice(0, MAX_NOTE) : '';
  if (
    !isObject(report.workbench) ||
    !isObject(report.workbench.values) ||
    !Array.isArray(report.workbench.off)
  )
    throw new ReportError('The report has bad workbench settings');
  try {
    // Unknown or out-of-range ids and values are refused here, before they reach the model.
    resolveTuning(report.car ?? undefined, {
      values: report.workbench.values as Record<string, number>,
    });
  } catch (e) {
    throw new ReportError(
      `The workbench settings in the report are not valid: ${plain((e as Error).message)}`,
    );
  }
  return report;
};

export interface Replay {
  /** The model's values at the moment: unchanged, and with the report's workbench settings. */
  at: { unchanged: Report['modelAtMoment']; tuned: Report['modelAtMoment'] };
  observed: (Observation & {
    unchanged: number | null;
    tuned: number | null;
    unchangedError: number | null;
    tunedError: number | null;
  })[];
  /** Largest gap between this run of the unchanged model and the one in the report, in degrees: rounding of the inputs. */
  roundingGap: number;
}

const valueOf = (m: Report['modelAtMoment'], o: Observation): number | null => {
  const c = m[o.corner];
  if (!c) return null;
  const v =
    o.quantity === 'pressure'
      ? c.pressureKpa
      : o.quantity === 'carcass'
        ? c.carcass
        : c.tread;
  return v === undefined ? null : v;
};

/** Runs the model again on a report's inputs, as the reporter's app did. */
export const replayReport = (report: Report): Replay => {
  const { t, fields, columns } = report.series;
  const car = report.car ?? undefined;
  const samples = t.map((_, i) => rebuild(fields, columns, t, i));
  // The last row at or before the moment (the first row if the moment is before them all).
  let at = t.length - 1;
  for (let i = 0; i < t.length; i++) {
    if (t[i] > report.moment.t) {
      at = Math.max(0, i - 1);
      break;
    }
  }
  const run = (tuning: Record<string, number>): Report['modelAtMoment'] => {
    const model = new OverlayModel(car, { tuning });
    let out = {} as ReturnType<OverlayModel['step']>;
    for (let i = 0; i <= at; i++) out = model.step(samples[i]);
    const m: Report['modelAtMoment'] = {};
    for (const c of CORNERS) {
      const carcass = out.carcass[c]?.value;
      const tread = out.tread?.[c]?.value;
      const pressure = out.pressure?.[c]?.kpa;
      if ([carcass, tread, pressure].some((v) => v !== undefined))
        m[c] = {
          ...(carcass !== undefined && { carcass: round(carcass, 2) }),
          ...(tread !== undefined && { tread: round(tread, 2) }),
          ...(pressure !== undefined && { pressureKpa: round(pressure, 1) }),
        };
    }
    return m;
  };
  const unchanged = run({});
  const tuned = run(report.workbench.values);
  let gap = 0;
  for (const c of CORNERS) {
    const a = unchanged[c]?.carcass;
    const b = report.modelAtMoment[c]?.carcass;
    if (a !== undefined && b !== undefined)
      gap = Math.max(gap, Math.abs(a - b));
  }
  return {
    at: { unchanged, tuned },
    observed: report.observed.map((o) => {
      const u = valueOf(unchanged, o);
      const w = valueOf(tuned, o);
      return {
        ...o,
        unchanged: u,
        tuned: w,
        unchangedError: u === null ? null : round(u - o.value, 2),
        tunedError: w === null ? null : round(w - o.value, 2),
      };
    }),
    roundingGap: round(gap, 3),
  };
};

/** The new-issue page of the repository, with the short fields filled in; the file itself is attached by hand. */
export const issueUrl = (report: Report, fileName: string): string => {
  const kinds: Record<ReportKind, string> = {
    mismatch: 'A tire value does not match the game',
    channel: 'A channel or unit is wrong',
    laps: 'Laps are wrong',
    bug: 'The program failed',
  };
  const seen = report.observed.length
    ? report.observed
        .map(
          (o) =>
            `${o.corner.toUpperCase()} ${o.quantity}: game ${o.value}, ${o.source}`,
        )
        .join('\n')
    : '';
  const params = new URLSearchParams({
    template: 'mismatch.yml',
    title: `${kinds[report.kind]} (${report.car ?? 'car not named'})`,
    car: report.session.carScreenName ?? report.car ?? '',
    track: report.session.trackName ?? '',
    seen: `${seen}\nAt session time ${report.moment.t} s.\nReport file to attach: ${fileName}\n${report.note}`
      .trim()
      .slice(0, 1200),
  });
  return `https://github.com/estem8/iracing-tire-lab/issues/new?${params.toString()}`;
};
