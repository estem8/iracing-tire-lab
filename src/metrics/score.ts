import { modelInputs, type ReplayOptions } from '../replay/replay.ts';
import type { ReplayFrame } from '../replay/samples.ts';
import type { TireModel, TireOutput } from '../model/types.ts';
import { errorStats, type ErrorStats } from './stats.ts';
import type { Reference } from './reference.ts';

export type Phase = 'track' | 'pit' | 'garage' | 'unknown';

/** What the model said at one step, and what the car was doing then. */
export interface ScoreStep {
  t: number;
  phase: Phase;
  output: TireOutput;
}

/** Steps a model at the overlay's rate; the phase comes from the sample's flags. */
export const scoreSteps = (
  model: TireModel,
  frames: Iterable<ReplayFrame>,
  options: ReplayOptions,
): ScoreStep[] => {
  model.reset();
  const steps: ScoreStep[] = [];
  for (const sample of modelInputs(frames, options)) {
    const { isOnTrack, onPitRoad } = sample.car;
    const phase: Phase =
      onPitRoad === true
        ? 'pit'
        : isOnTrack === true
          ? 'track'
          : isOnTrack === false
            ? 'garage'
            : 'unknown';
    steps.push({ t: sample.t, phase, output: model.step(sample) });
  }
  return steps;
};

export interface ScoreOptions {
  /** A reference is matched to the latest step at or before it, if within this many seconds. Default 1. */
  maxGapS?: number;
}

export interface Group {
  key: string;
  stats: ErrorStats;
}

export interface Score {
  overall: ErrorStats;
  byCorner: Group[];
  byQuantity: Group[];
  byPhase: Group[];
  byKind: Group[];
  /** References with no step to compare to: before the first step, too far from one, or the model had no value. */
  unmatched: number;
  /** Every pair, for plotting or a closer look. */
  pairs: {
    t: number;
    corner: string;
    quantity: string;
    kind: string;
    phase: Phase;
    model: number;
    reference: number;
  }[];
}

const group = (
  pairs: { error: number }[],
  key: (i: number) => string,
): Group[] => {
  const by = new Map<string, number[]>();
  pairs.forEach((p, i) => {
    const k = key(i);
    by.set(k, [...(by.get(k) ?? []), p.error]);
  });
  return [...by.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, errors]) => ({ key: k, stats: errorStats(errors) }));
};

export const score = (
  steps: readonly ScoreStep[],
  reference: Reference,
  options: ScoreOptions = {},
): Score => {
  const maxGap = options.maxGapS ?? 1;
  const made: Score['pairs'] = [];
  let unmatched = 0;
  for (const r of reference.readings) {
    // Latest step at or before the reading (steps are in time order).
    let lo = 0;
    let hi = steps.length - 1;
    let at = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (steps[mid].t <= r.t) {
        at = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    const step = at >= 0 ? steps[at] : undefined;
    const value = step?.output[r.quantity]?.[r.corner]?.value;
    if (!step || r.t - step.t > maxGap || value === undefined) {
      unmatched++;
      continue;
    }
    made.push({
      t: r.t,
      corner: r.corner,
      quantity: r.quantity,
      kind: r.kind,
      phase: step.phase,
      model: value,
      reference: r.value,
    });
  }
  const withError = made.map((p) => ({ ...p, error: p.model - p.reference }));
  return {
    overall: errorStats(withError.map((p) => p.error)),
    byCorner: group(withError, (i) => withError[i].corner),
    byQuantity: group(withError, (i) => withError[i].quantity),
    byPhase: group(withError, (i) => withError[i].phase),
    byKind: group(withError, (i) => withError[i].kind),
    unmatched,
    pairs: made,
  };
};

const f = (v: number | null): string => (v === null ? '-' : v.toFixed(1));

/** The result as a text table. Errors are model minus reference, in deg C. */
export const formatScore = (s: Score): string => {
  const row = (label: string, st: ErrorStats) =>
    `${label.padEnd(16)}${String(st.n).padStart(5)}${f(st.mae).padStart(8)}${f(st.rmse).padStart(8)}${f(st.max).padStart(8)}${f(st.bias).padStart(8)}`;
  const lines = [
    `${''.padEnd(16)}${'n'.padStart(5)}${'MAE'.padStart(8)}${'RMSE'.padStart(8)}${'max'.padStart(8)}${'bias'.padStart(8)}`,
    row('all', s.overall),
  ];
  const section = (title: string, groups: Group[]) => {
    if (groups.length === 0) return;
    lines.push(`by ${title}`);
    for (const g of groups) lines.push(row('  ' + g.key, g.stats));
  };
  section('corner', s.byCorner);
  section('quantity', s.byQuantity);
  section('phase', s.byPhase);
  section('kind', s.byKind);
  if (s.unmatched > 0)
    lines.push(
      `${s.unmatched} reference value(s) had no model value to compare to`,
    );
  lines.push(
    'errors are model minus reference, deg C; bias > 0 means the model reads high',
  );
  return lines.join('\n');
};
