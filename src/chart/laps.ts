/**
 * Laps of a recording, and a chart that lines up one lap, or two, by distance
 * round the lap instead of by time. With two laps the second is dashed in the
 * colours of the first and a chart of the time difference is added.
 *
 * Channels used (all unverified against a real recording, see
 * channels/channels.yaml): Lap, LapDistPct, LapDist, SessionTime. A lap with no
 * LapDistPct cannot be placed on the distance axis, so a file without it has no
 * laps here.
 */
import { readVarValue } from '../ibt/binary.ts';
import type { IbtFile } from '../ibt/reader.ts';
import { summarizeSession } from '../ibt/session.ts';
import { parseColumn } from '../ibt/column.ts';
import type { ScoreStep } from '../metrics/score.ts';
import type { ChartData, ChartSeries } from './data.ts';
import { defaultChannels } from './data.ts';

export interface Lap {
  /** The lap number the sim gives, or a count from 1 when the file has no Lap channel. */
  lap: number;
  /** First and last record of the lap (inclusive). */
  first: number;
  last: number;
  startS: number;
  endS: number;
  /** Lap time, s: to the start of the next lap. Null for a lap that is not whole or last. */
  timeS: number | null;
  /** Covers the lap from the start line to the finish: not an out lap, an in lap or a spin-out. */
  complete: boolean;
}

const GRID_POINTS = 1000;
/** Per record: distance along the lap (a fraction), the sim's lap number, the clock. */
interface Sample {
  index: number;
  pct: number;
  lap: number | undefined;
  t: number;
}

const samplesOf = (file: IbtFile): Sample[] => {
  const pctH = file.channel('LapDistPct');
  if (!pctH) return [];
  const lapH = file.channel('Lap');
  const timeH = file.channel('SessionTime');
  const out: Sample[] = [];
  for (let i = 0; i < file.recordCount; i++) {
    const rec = file.readRecord(i);
    const pct = readVarValue(rec, pctH);
    // Off the world the sim reports a negative fraction.
    if (!Number.isFinite(pct) || pct < 0 || pct > 1) continue;
    const t = timeH
      ? readVarValue(rec, timeH)
      : i / Math.max(1, file.header.tickRate);
    if (!Number.isFinite(t)) continue;
    const lap = lapH ? readVarValue(rec, lapH) : undefined;
    out.push({ index: i, pct, lap: Number.isFinite(lap) ? lap : undefined, t });
  }
  return out;
};

/** Splits records into laps: when the sim's lap number changes, else when the distance wraps round. */
export const findLaps = (file: IbtFile): Lap[] => {
  const samples = samplesOf(file);
  const useLapChannel =
    samples.length > 0 && samples.every((s) => s.lap !== undefined);
  const segments: Sample[][] = [];
  let count = 0;
  samples.forEach((s, i) => {
    const prev = samples[i - 1];
    const newLap =
      prev === undefined ||
      (useLapChannel ? s.lap !== prev.lap : prev.pct - s.pct > 0.5);
    if (newLap) {
      segments.push([]);
      count++;
    }
    segments[segments.length - 1].push(s);
  });
  return segments.map((seg, k) => {
    const first = seg[0];
    const last = seg[seg.length - 1];
    const next = segments[k + 1]?.[0];
    const lo = Math.min(...seg.map((s) => s.pct));
    const hi = Math.max(...seg.map((s) => s.pct));
    const complete = lo <= 0.05 && hi >= 0.95 && next !== undefined;
    return {
      lap: useLapChannel ? (first.lap as number) : k + 1,
      first: first.index,
      last: last.index,
      startS: first.t,
      endS: last.t,
      timeS: complete ? next.t - first.t : null,
      complete,
    };
  });
};

const lookup = (
  steps: readonly ScoreStep[],
  t: number,
): ScoreStep | undefined => {
  let lo = 0;
  let hi = steps.length - 1;
  let at = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (steps[mid].t <= t) {
      at = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return at >= 0 && t - steps[at].t <= 1 ? steps[at] : undefined;
};

/** Values at the grid by linear interpolation along an increasing x; null outside it or beside a gap. */
const onGrid = (
  xs: number[],
  ys: (number | null)[],
  grid: number[],
): (number | null)[] => {
  const out: (number | null)[] = [];
  let j = 0;
  for (const g of grid) {
    if (xs.length === 0 || g < xs[0] || g > xs[xs.length - 1]) {
      out.push(null);
      continue;
    }
    while (j + 1 < xs.length - 1 && xs[j + 1] < g) j++;
    const a = ys[j];
    const b = ys[Math.min(j + 1, xs.length - 1)];
    if (a === null || b === null) {
      out.push(null);
      continue;
    }
    const x0 = xs[j];
    const x1 = xs[Math.min(j + 1, xs.length - 1)];
    out.push(x1 === x0 ? a : a + ((b - a) * (g - x0)) / (x1 - x0));
  }
  return out;
};

export interface LapChartOptions {
  /** Column specs. Default: the tire channels the file has. */
  channels?: string[];
  /** The model's steps; with one lap its lines are drawn beside the recorded ones. */
  steps?: readonly ScoreStep[];
}

/** One lap, or two to compare, on a distance axis. */
export const buildLapChart = (
  file: IbtFile,
  laps: readonly Lap[],
  options: LapChartOptions = {},
): ChartData => {
  if (laps.length < 1 || laps.length > 2)
    throw new Error('Pick one lap, or two to compare');
  const pctH = file.channel('LapDistPct');
  if (!pctH)
    throw new Error(
      'The file has no LapDistPct channel, so laps cannot be placed',
    );
  const metresH = file.channel('LapDist');
  const timeH = file.channel('SessionTime');
  const specs = options.channels?.length
    ? options.channels
    : defaultChannels(file);
  if (specs.length === 0)
    throw new Error(
      'None of the default tire channels are in this file; name some with --channels',
    );
  const columns = specs.map(parseColumn);
  const headers = file.require(columns.map((c) => c.name));
  const unit = metresH ? 'm' : '%';

  // Per lap: distance, clock, each channel and (one lap only) the model, by record.
  const perLap = laps.map((lap) => {
    const xs: number[] = [];
    const ts: number[] = [];
    const values: (number | null)[][] = specs.map(() => []);
    const model = new Map<string, (number | null)[]>();
    for (let r = lap.first; r <= lap.last; r++) {
      const rec = file.readRecord(r);
      const pct = readVarValue(rec, pctH);
      if (!Number.isFinite(pct) || pct < 0 || pct > 1) continue;
      const x = metresH ? readVarValue(rec, metresH) : pct * 100;
      const t = timeH
        ? readVarValue(rec, timeH)
        : r / Math.max(1, file.header.tickRate);
      // Distance must increase: a record that goes back (a spin, a reverse) is skipped.
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(t) ||
        (xs.length > 0 && x <= xs[xs.length - 1])
      )
        continue;
      xs.push(x);
      ts.push(t - lap.startS);
      headers.forEach((h, i) => {
        const v = readVarValue(rec, h, columns[i].index);
        values[i].push(Number.isFinite(v) ? v : null);
      });
      if (options.steps && laps.length === 1) {
        const step = lookup(options.steps, t);
        for (const q of ['carcass', 'tread'] as const)
          for (const c of ['lf', 'rf', 'lr', 'rr'] as const) {
            const key = `${c}.${q}`;
            const list = model.get(key) ?? [];
            list.push(step?.output[q]?.[c]?.value ?? null);
            model.set(key, list);
          }
      }
    }
    return { lap, xs, ts, values, model };
  });

  const lo = Math.max(...perLap.map((p) => p.xs[0] ?? Infinity));
  const hi = Math.min(...perLap.map((p) => p.xs[p.xs.length - 1] ?? -Infinity));
  if (!(hi > lo)) throw new Error('The chosen laps have no distance in common');
  const grid = Array.from(
    { length: GRID_POINTS },
    (_, i) => lo + ((hi - lo) * i) / (GRID_POINTS - 1),
  );
  const round = (v: number | null) =>
    v === null ? null : Math.round(v * 1000) / 1000;

  const series: ChartSeries[] = [];
  perLap.forEach((p, k) => {
    const tag = ` L${p.lap.lap}`;
    specs.forEach((name, i) => {
      series.push({
        name: name + tag,
        unit: headers[i].unit,
        values: onGrid(p.xs, p.values[i], grid).map(round),
        ...(k === 1 && {
          dashed: true,
          like: specs[i] + ` L${perLap[0].lap.lap}`,
        }),
      });
    });
  });
  if (perLap.length === 2) {
    const [a, b] = perLap.map((p) => onGrid(p.xs, p.ts, grid));
    series.push({
      name: `time, L${perLap[1].lap.lap} minus L${perLap[0].lap.lap}`,
      unit: 's',
      values: a.map((v, i) =>
        v === null || b[i] === null ? null : round((b[i] as number) - v),
      ),
    });
  } else {
    const p = perLap[0];
    const unitC =
      series.find((s) => /tempCM$|tempM$/.test(s.name.replace(/ L\d+$/, '')))
        ?.unit ?? 'C';
    for (const q of ['carcass', 'tread'] as const)
      for (const [c, label] of [
        ['lf', 'LF'],
        ['rf', 'RF'],
        ['lr', 'LR'],
        ['rr', 'RR'],
      ] as const) {
        const list = p.model.get(`${c}.${q}`);
        if (!list || list.every((v) => v === null)) continue;
        series.push({
          name: `model ${label} ${q}${` L${p.lap.lap}`}`,
          unit: unitC,
          values: onGrid(p.xs, list, grid).map(round),
          dashed: true,
          like: `${label}${q === 'carcass' ? 'tempCM' : 'tempM'} L${p.lap.lap}`,
        });
      }
  }

  const base = summarizeSession(file.sessionYaml);
  const where = [base.carScreenName ?? base.carPath, base.trackName]
    .filter(Boolean)
    .join(' · ');
  return {
    title: `${where || 'iRacing telemetry'} · ${
      perLap.length === 1
        ? `lap ${perLap[0].lap.lap}`
        : `laps ${perLap[0].lap.lap} and ${perLap[1].lap.lap}`
    }`,
    tickRate: file.header.tickRate,
    records: file.recordCount,
    stride: 1,
    xName: metresH ? 'LapDist' : 'LapDistPct',
    xLabel: 'Distance',
    xUnit: unit,
    x: grid.map(round) as number[],
    series,
  };
};
