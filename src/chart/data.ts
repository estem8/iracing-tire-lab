/**
 * The data behind a chart: chosen channels of an .ibt, thinned to a size a
 * browser can draw, with the unit the file itself declares. A value the file
 * cannot give (not finite) is null, which the chart draws as a gap, never 0.
 */
import { formatValue, readVarValue } from '../ibt/binary.ts';
import { parseColumn } from '../ibt/column.ts';
import type { IbtFile } from '../ibt/reader.ts';
import { summarizeSession } from '../ibt/session.ts';

export interface ChartSeries {
  /** The column spec: `Name` or `Name[i]`. */
  name: string;
  /** As the file declares it; '' when it declares none. */
  unit: string;
  values: (number | null)[];
  /** A model's output, drawn dashed; the file did not record it. */
  dashed?: boolean;
  /** Share the colour of the series with this name, so one tire keeps one colour. */
  like?: string;
}

export interface ChartData {
  /** Car, track and air temperature: no personal fields. */
  title: string;
  tickRate: number;
  /** Records in the file. */
  records: number;
  /** Every `stride`-th record is a point. */
  stride: number;
  xName: string;
  /** Seconds, ascending. */
  x: number[];
  series: ChartSeries[];
}

export interface ChartOptions {
  /** Column specs. Default: the tire channels the file has (see defaultChannels). */
  channels?: string[];
  /** Upper bound on points per series when no stride is given. Default 5000. */
  maxPoints?: number;
  stride?: number;
}

const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;

/**
 * Tire-relevant channels, kept to those the file records. The middle carcass
 * and the middle surface zone of each tire, speed and the pedals. Whether a
 * given channel exists depends on the car; see channels/channels.yaml.
 */
export const defaultChannels = (file: IbtFile): string[] =>
  [
    ...CORNERS.map((c) => `${c}tempCM`),
    ...CORNERS.map((c) => `${c}tempM`),
    'Speed',
    'Throttle',
    'Brake',
  ].filter((name) => file.channel(name) !== undefined);

const titleOf = (file: IbtFile): string => {
  const s = summarizeSession(file.sessionYaml);
  const parts = [
    s.carScreenName ?? s.carPath,
    s.trackName,
    s.trackAirTemp ? `air ${s.trackAirTemp}` : undefined,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(' · ') : 'iRacing telemetry';
};

export const buildChartData = (
  file: IbtFile,
  options: ChartOptions = {},
): ChartData => {
  const records = file.recordCount;
  if (records < 1) throw new Error('The file has no sample records');

  const specs = options.channels?.length
    ? options.channels
    : defaultChannels(file);
  if (specs.length === 0) {
    throw new Error(
      'None of the default tire channels are in this file; name some with --channels',
    );
  }
  const columns = specs.map(parseColumn);
  const headers = file.require(columns.map((c) => c.name));

  const stride = Math.max(
    1,
    options.stride ?? Math.ceil(records / (options.maxPoints ?? 5000)),
  );
  const timeHeader = file.channel('SessionTime');
  const x: number[] = [];
  const series: ChartSeries[] = specs.map((name, i) => ({
    name,
    unit: headers[i].unit,
    values: [],
  }));

  for (let r = 0; r < records; r += stride) {
    const rec = file.readRecord(r);
    x.push(
      timeHeader
        ? readVarValue(rec, timeHeader)
        : r / Math.max(1, file.header.tickRate),
    );
    headers.forEach((h, i) => {
      const v = readVarValue(rec, h, columns[i].index);
      series[i].values.push(
        Number.isFinite(v) ? Number(formatValue(v, h.type)) : null,
      );
    });
  }

  // The chart looks values up by time, which needs it ascending. A recording
  // whose clock jumps back (a rewound replay) falls back to the record rate.
  let xName = timeHeader ? 'SessionTime' : 'record / tick rate';
  const ascending = x.every(
    (t, i) => Number.isFinite(t) && (i === 0 || t >= x[i - 1]),
  );
  if (!ascending) {
    xName = 'record / tick rate (SessionTime is not ascending)';
    for (let i = 0; i < x.length; i++) {
      x[i] = (i * stride) / Math.max(1, file.header.tickRate);
    }
  }

  return {
    title: titleOf(file),
    tickRate: file.header.tickRate,
    records,
    stride,
    xName,
    x,
    series,
  };
};
