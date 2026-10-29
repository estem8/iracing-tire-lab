import type { ScoreStep } from '../metrics/score.ts';
import type { Corner } from '../model/types.ts';
import type { ChartData, ChartSeries } from './data.ts';

const CORNERS: [Corner, string][] = [
  ['lf', 'LF'],
  ['rf', 'RF'],
  ['lr', 'LR'],
  ['rr', 'RR'],
];

export interface ModelSeriesOptions {
  /** A model step is shown at the chart points up to this many seconds after it. Default 1. */
  maxGapS?: number;
  /** The name in front of each series: 'model' by default. */
  label?: string;
  /** Draw the lines dotted instead of dashed, to tell a second model from the first. */
  dotted?: boolean;
}

/**
 * Adds a model's output to a chart, beside the recorded channels. Each tire's
 * carcass series is drawn dashed in the colour of that tire's recorded
 * `tempCM` series, and the tread in that of `tempM`, when the chart has them.
 *
 * Points the model has no value for (before its first step, or past the gap)
 * are null, never 0. The chart's clock must be SessionTime, since that is the
 * clock of the steps.
 */
export const addModelSeries = (
  data: ChartData,
  steps: readonly ScoreStep[],
  options: ModelSeriesOptions = {},
): ChartData => {
  if (data.xName !== 'SessionTime') {
    throw new Error(
      `The chart's clock is "${data.xName}", not SessionTime, so model steps cannot be placed on it`,
    );
  }
  const maxGap = options.maxGapS ?? 1;
  const name = options.label ?? 'model';
  const unit =
    data.series.find((s) => /tempCM$|tempM$/.test(s.name))?.unit ?? 'C';
  const made: ChartSeries[] = [];
  for (const quantity of ['carcass', 'tread'] as const) {
    for (const [corner, label] of CORNERS) {
      if (!steps.some((s) => s.output[quantity]?.[corner] !== undefined))
        continue;
      const values: (number | null)[] = [];
      let at = -1;
      for (const t of data.x) {
        // x is ascending, so the step index only moves forward.
        while (at + 1 < steps.length && steps[at + 1].t <= t) at++;
        const step = at >= 0 ? steps[at] : undefined;
        const v = step?.output[quantity]?.[corner]?.value;
        values.push(
          step !== undefined && v !== undefined && t - step.t <= maxGap
            ? Math.round(v * 100) / 100
            : null,
        );
      }
      made.push({
        name: `${name} ${label} ${quantity}`,
        unit,
        values,
        ...(options.dotted ? { dotted: true } : { dashed: true }),
        like: `${label}${quantity === 'carcass' ? 'tempCM' : 'tempM'}`,
      });
    }
  }
  return { ...data, series: [...data.series, ...made] };
};
