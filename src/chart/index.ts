/** A self-contained HTML chart of an .ibt's channels, with a switch per series. */
export {
  buildChartData,
  defaultChannels,
  type ChartData,
  type ChartOptions,
  type ChartSeries,
  type TireCornerSeries,
  type TirePanel,
} from './data.ts';
export { renderChartHtml } from './html.ts';
export { addModelSeries, type ModelSeriesOptions } from './model.ts';
export {
  buildLapChart,
  findLaps,
  type Lap,
  type LapChartOptions,
} from './laps.ts';
export { addTirePanel } from './tires.ts';
