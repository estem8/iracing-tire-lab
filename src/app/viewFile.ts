import {
  addModelSeries,
  buildChartData,
  addTirePanel,
  buildLapChart,
  findLaps,
  renderChartHtml,
  type Lap,
} from '../chart/index.ts';
import { IbtFile } from '../ibt/reader.ts';
import { summarizeSession, type SessionSummary } from '../ibt/session.ts';
import { makeSamples, stepSamples, type ScoreStep } from '../metrics/index.ts';
import type { TireSample } from '../model/types.ts';
import { OverlayModel } from '../model/overlayModel.ts';
import { PRODUCTION_HZ, APP_ARRIVAL_HZ } from '../replay/replay.ts';
import { frames } from '../replay/samples.ts';

/** What a report says about the file: no personal fields. */
export interface FileMeta {
  session: SessionSummary;
  file: { tickRate: number; records: number; durationS: number };
  channels: { name: string; unit: string; desc: string; count: number }[];
}

export interface FilePage {
  meta: FileMeta;
  html: string;
  /** Records in the file. */
  records: number;
  /** The car's path as the recording names it, if it does. */
  car: string | undefined;
  /** Whether the model's lines are on the chart. */
  hasModel: boolean;
  /** Why the model's lines are missing, when they are. */
  note: string | undefined;
  /** The laps of the recording; empty when the file has no LapDistPct. */
  laps: Lap[];
  /** What the model said along the recording, kept for the lap charts. */
  steps: ScoreStep[];
  /** The model's inputs at the overlay's rate, kept so the workbench can run the model again. */
  samples: TireSample[];
}

/**
 * The chart page of a recording, with the overlay model beside the recorded
 * channels (the same page as `tire-lab chart --model`). A file the model cannot
 * read (no wear channels, say) still gets its chart, with a note.
 */
export const renderFilePage = (path: string): FilePage => {
  const file = IbtFile.open(path);
  try {
    let data = buildChartData(file);
    const session = summarizeSession(file.sessionYaml);
    const car = session.carPath;
    let note: string | undefined;
    let steps: ScoreStep[] = [];
    let samples: TireSample[] = [];
    try {
      samples = makeSamples(frames(file), {
        hz: PRODUCTION_HZ,
        arrivalHz: APP_ARRIVAL_HZ,
        mask: 'live',
      });
      steps = stepSamples(new OverlayModel(car), samples);
      data = addTirePanel(addModelSeries(data, steps), file, steps);
    } catch (e) {
      note = `The model could not be drawn: ${(e as Error).message}`;
    }
    const hasModel = data.series.some((s) => s.name.startsWith('model '));
    if (!hasModel && note === undefined) {
      note =
        'No model lines: the model needs the *tempC and *wear channels of all three zones of a tire, and this file lacks them.';
    }
    return {
      html: renderChartHtml(data),
      records: file.recordCount,
      car,
      hasModel,
      note,
      laps: findLaps(file),
      steps,
      samples,
      meta: {
        session,
        file: {
          tickRate: file.header.tickRate,
          records: file.recordCount,
          durationS: file.recordCount / Math.max(1, file.header.tickRate),
        },
        channels: file.vars.map((v) => ({
          name: v.name,
          unit: v.unit,
          desc: v.desc,
          count: v.count,
        })),
      },
    };
  } finally {
    file.close();
  }
};

/** One lap of a recording, or two to compare, by distance round the lap (with the model for one). */
export const renderLapPage = (
  path: string,
  page: FilePage,
  lapA: number,
  lapB: number | undefined,
): string => {
  const find = (n: number): Lap => {
    const lap = page.laps.find((l) => l.lap === n);
    if (!lap) throw new Error(`The file has no lap ${n}`);
    return lap;
  };
  const picked = lapB === undefined ? [find(lapA)] : [find(lapA), find(lapB)];
  const file = IbtFile.open(path);
  try {
    return renderChartHtml(
      addTirePanel(
        buildLapChart(file, picked, { steps: page.steps }),
        file,
        page.steps,
      ),
    );
  } finally {
    file.close();
  }
};
