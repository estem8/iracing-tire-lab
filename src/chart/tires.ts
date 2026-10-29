/**
 * The tires beside the chart: for each point of the chart, what the overlay
 * model would show for each tire (the three zones, pressure) and the sim's own
 * tread reading. The model's values are estimates; the wear is not (it is the
 * sim's last reading, frozen between pit stops), and the page says so.
 */
import { readVarValue } from '../ibt/binary.ts';
import type { IbtFile } from '../ibt/reader.ts';
import type { ScoreStep } from '../metrics/score.ts';
import type { ChartData, TireCornerSeries, TirePanel } from './data.ts';

const CORNERS = ['lf', 'rf', 'lr', 'rr'] as const;
const PREFIX = { lf: 'LF', rf: 'RF', lr: 'LR', rr: 'RR' } as const;
const ZONES = ['L', 'M', 'R'] as const;

const lookup = (
  steps: readonly ScoreStep[],
  t: number,
  from: number,
): number => {
  // Steps and points are both in time order, so the search only moves forward.
  let at = from;
  while (at + 1 < steps.length && steps[at + 1].t <= t) at++;
  return at;
};

export const addTirePanel = (
  data: ChartData,
  file: IbtFile,
  steps: readonly ScoreStep[],
): ChartData => {
  const records = data.pointRecords;
  if (!records || records.length === 0 || steps.length === 0) return data;
  if (
    !steps.some((s) => s.output.shown && Object.keys(s.output.shown).length > 0)
  )
    return data;
  const timeH = file.channel('SessionTime');
  const wearH = Object.fromEntries(
    CORNERS.map((c) => [
      c,
      ZONES.map((z) => file.channel(`${PREFIX[c]}wear${z}`)),
    ]),
  );
  const empty = (): (number | null)[] => records.map(() => null);
  const panel = Object.fromEntries(
    CORNERS.map((c): [string, TireCornerSeries] => [
      c,
      {
        temp: [empty(), empty(), empty()],
        tread: empty(),
        disc: empty(),
        pressure: empty(),
        pressureEstimated: empty(),
        wear: [empty(), empty(), empty()],
      },
    ]),
  ) as TirePanel['corners'];

  let at = -1;
  records.forEach((r, i) => {
    const rec = file.readRecord(r);
    const t = timeH
      ? readVarValue(rec, timeH)
      : r / Math.max(1, file.header.tickRate);
    at = lookup(steps, t, Math.max(at, 0));
    // The latest step at or before the point, if it is recent enough.
    const step =
      steps[at]?.t <= t && t - steps[at].t <= 1 ? steps[at] : undefined;
    for (const c of CORNERS) {
      const shown = step?.output.shown?.[c]?.value;
      if (shown)
        ZONES.forEach(
          (_, k) => (panel[c].temp[k][i] = Math.round(shown[k] * 10) / 10),
        );
      const tread = step?.output.tread?.[c]?.value;
      if (tread !== undefined) panel[c].tread[i] = Math.round(tread * 10) / 10;
      const disc = step?.output.disc?.[c];
      if (disc !== undefined) panel[c].disc[i] = disc;
      const pressure = step?.output.pressure?.[c];
      if (pressure) {
        panel[c].pressure[i] = pressure.kpa;
        panel[c].pressureEstimated[i] = pressure.estimated ? 1 : 0;
      }
      wearH[c].forEach((h, k) => {
        if (!h) return;
        const v = readVarValue(rec, h);
        if (Number.isFinite(v)) panel[c].wear[k][i] = Math.round(v * 1000) / 10;
      });
    }
  });
  return { ...data, tires: { corners: panel } };
};
