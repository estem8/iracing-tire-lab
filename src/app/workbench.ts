/**
 * The workbench: run the overlay's tire model on an open recording with some of
 * its components switched off or its constants changed, and see the result
 * next to the unchanged model and the recording. What it can say is how the
 * estimate responds; it is not a claim about the game.
 */
import {
  addModelSeries,
  addTirePanel,
  buildChartData,
  renderChartHtml,
} from '../chart/index.ts';
import { IbtFile } from '../ibt/reader.ts';
import {
  errorStats,
  stepSamples,
  type ErrorStats,
  type ScoreStep,
} from '../metrics/index.ts';
import {
  describeTuning,
  resolveTuning,
  type TuningDescription,
  type TuningRequest,
} from '../model/tuning.ts';
import { OverlayModel } from '../model/overlayModel.ts';
import type { Corner } from '../model/types.ts';
import type { FilePage } from './viewFile.ts';

const CORNERS: Corner[] = ['lf', 'rf', 'lr', 'rr'];

/** What the model reads that a chart should show beside the tires: the drivers of the heat. */
const DRIVER_CHANNELS = [
  'Speed',
  'LatAccel',
  'LongAccel',
  'Brake',
  'Throttle',
  'SteeringWheelAngle',
];

export interface ChannelInfo {
  name: string;
  unit: string;
  desc: string;
  count: number;
}

export interface WorkbenchRequest extends TuningRequest {
  /** Channels to chart besides the model; default: the tire temperatures and the drivers of the heat. */
  channels?: string[];
}

export interface WorkbenchResult {
  html: string;
  /** How far the changed model is from the unchanged one, per tire, in degrees C. */
  difference: { corner: Corner; stats: ErrorStats; last: number | null }[];
  /** The values the run used, switch-offs included. */
  values: Record<string, number>;
  channels: string[];
}

export interface WorkbenchInfo {
  description: TuningDescription;
  /** For every channel a component reads: whether the file has it, and its unit. */
  availability: Record<string, { present: boolean; unit: string }>;
  channels: ChannelInfo[];
  defaultChannels: string[];
}

export const listChannels = (file: IbtFile): ChannelInfo[] =>
  file.vars.map((v) => ({
    name: v.name,
    unit: v.unit,
    desc: v.desc,
    count: v.count,
  }));

const defaultChannelsOf = (file: IbtFile): string[] =>
  [
    ...CORNERS.map((c) => `${c.toUpperCase()}tempCM`),
    ...CORNERS.map((c) => `${c.toUpperCase()}tempM`),
    ...DRIVER_CHANNELS,
  ].filter((n) => file.channel(n) !== undefined);

export const workbenchInfo = (path: string, page: FilePage): WorkbenchInfo => {
  const file = IbtFile.open(path);
  try {
    const description = describeTuning(page.car);
    const availability: WorkbenchInfo['availability'] = {};
    for (const c of description.components)
      for (const name of c.inputs) {
        // Names with a * or a note are descriptions, not channels.
        if (/[* ()]/.test(name) || name in availability) continue;
        const h = file.channel(name);
        availability[name] = { present: h !== undefined, unit: h?.unit ?? '' };
      }
    return {
      description,
      availability,
      channels: listChannels(file),
      defaultChannels: defaultChannelsOf(file),
    };
  } finally {
    file.close();
  }
};

const difference = (base: readonly ScoreStep[], tuned: readonly ScoreStep[]) =>
  CORNERS.map((corner) => {
    const errors: number[] = [];
    let last: number | null = null;
    tuned.forEach((step, i) => {
      const a = step.output.carcass[corner]?.value;
      const b = base[i]?.output.carcass[corner]?.value;
      if (a !== undefined && b !== undefined) {
        errors.push(a - b);
        last = a - b;
      }
    });
    return { corner, stats: errorStats(errors), last };
  });

export const runWorkbench = (
  path: string,
  page: FilePage,
  request: WorkbenchRequest,
): WorkbenchResult => {
  if (page.samples.length === 0)
    throw new Error(
      'The model cannot run on this file: it needs the *tempC and *wear channels',
    );
  const values = resolveTuning(page.car, request);
  const tuned = stepSamples(
    new OverlayModel(page.car, { tuning: values }),
    page.samples,
  );
  const file = IbtFile.open(path);
  try {
    const channels = (
      request.channels?.length ? request.channels : defaultChannelsOf(file)
    ).slice(0, 40);
    for (const name of channels) {
      if (
        !/^[A-Za-z0-9_]+(\[\d+\])?$/.test(name) ||
        file.channel(name.replace(/\[\d+\]$/, '')) === undefined
      )
        throw new Error(`The file has no channel ${name}`);
    }
    let data = buildChartData(file, { channels });
    data = addModelSeries(data, page.steps, { label: 'default', dotted: true });
    data = addModelSeries(data, tuned, { label: 'tuned' });
    data = addTirePanel(data, file, tuned);
    return {
      html: renderChartHtml(data),
      difference: difference(page.steps, tuned),
      values: { ...values },
      channels,
    };
  } finally {
    file.close();
  }
};
