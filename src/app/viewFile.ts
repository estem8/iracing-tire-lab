import {
  addModelSeries,
  buildChartData,
  renderChartHtml,
} from '../chart/index.ts';
import { IbtFile } from '../ibt/reader.ts';
import { summarizeSession } from '../ibt/session.ts';
import { scoreSteps } from '../metrics/index.ts';
import { OverlayModel } from '../model/overlayModel.ts';
import { PRODUCTION_HZ, APP_ARRIVAL_HZ } from '../replay/replay.ts';
import { frames } from '../replay/samples.ts';

export interface FilePage {
  html: string;
  /** Records in the file. */
  records: number;
  /** The car's path as the recording names it, if it does. */
  car: string | undefined;
  /** Whether the model's lines are on the chart. */
  hasModel: boolean;
  /** Why the model's lines are missing, when they are. */
  note: string | undefined;
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
    const car = summarizeSession(file.sessionYaml).carPath;
    let note: string | undefined;
    try {
      const steps = scoreSteps(new OverlayModel(car), frames(file), {
        hz: PRODUCTION_HZ,
        arrivalHz: APP_ARRIVAL_HZ,
        mask: 'live',
      });
      data = addModelSeries(data, steps);
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
    };
  } finally {
    file.close();
  }
};
