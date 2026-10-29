import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { IbtVarType } from '../src/ibt/types.ts';
import { buildLapChart, findLaps } from '../src/chart/laps.ts';
import { IbtFile } from '../src/ibt/reader.ts';
import { renderLapPage, renderFilePage } from '../src/app/viewFile.ts';
import { writeLapsIbt, writeSyntheticIbt } from './helpers/syntheticIbt.ts';

const open = <T>(file: string, fn: (f: IbtFile) => T): T => {
  const f = IbtFile.open(file);
  try {
    return fn(f);
  } finally {
    f.close();
  }
};

test('findLaps: the out lap and the cut-off lap are not whole, the others have their times', () => {
  const file = writeLapsIbt();
  const laps = open(file, findLaps);
  assert.deepEqual(
    laps.map((l) => l.lap),
    [0, 1, 2, 3, 4],
  );
  assert.deepEqual(
    laps.map((l) => l.complete),
    [false, true, true, true, false],
  );
  const times = laps.map((l) => l.timeS);
  assert.equal(times[0], null);
  assert.equal(times[4], null);
  // 60, 58, 61 s laps, to the start of the next (one record of rounding at most)
  [60, 58, 61].forEach((t, i) =>
    assert.ok(
      Math.abs((times[i + 1] as number) - t) < 0.05,
      `lap ${i + 1}: ${times[i + 1]}`,
    ),
  );
  fs.rmSync(file);
});

test('findLaps without a Lap channel splits where the distance wraps round', () => {
  const file = writeLapsIbt({ lapChannel: false });
  const laps = open(file, findLaps);
  assert.deepEqual(
    laps.map((l) => l.lap),
    [1, 2, 3, 4, 5],
  ); // counted from 1
  assert.deepEqual(
    laps.map((l) => l.complete),
    [false, true, true, true, false],
  );
  fs.rmSync(file);
});

test('a file without LapDistPct has no laps, and a lap chart says so', () => {
  const file = writeSyntheticIbt(true);
  assert.deepEqual(open(file, findLaps), []);
  assert.throws(
    () =>
      open(file, (f) =>
        buildLapChart(
          f,
          [
            {
              lap: 1,
              first: 0,
              last: 10,
              startS: 0,
              endS: 1,
              timeS: null,
              complete: false,
            },
          ],
          {},
        ),
      ),
    /no LapDistPct/,
  );
  fs.rmSync(file);
});

test('one lap on the distance axis: percent, ascending, the model beside the recorded lines', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const lap = page.laps.find((l) => l.lap === 2)!;
  const data = open(file, (f) =>
    buildLapChart(f, [lap], { steps: page.steps }),
  );
  assert.equal(data.xUnit, '%');
  assert.equal(data.xLabel, 'Distance');
  assert.equal(data.x.length, 1000);
  assert.ok(data.x.every((v, i) => i === 0 || v > data.x[i - 1]));
  assert.ok(data.x[0] < 1 && data.x[999] > 99);
  const names = data.series.map((s) => s.name);
  assert.ok(names.includes('LFtempCM L2'));
  const model = data.series.find((s) => s.name === 'model LF carcass L2')!;
  assert.equal(model.dashed, true);
  assert.equal(model.like, 'LFtempCM L2');
  assert.ok(model.values.some((v) => v !== null));
  assert.match(data.title, /lap 2$/);
  fs.rmSync(file);
});

test('metres are used when the file has LapDist', () => {
  const file = writeLapsIbt({ metres: true });
  const page = renderFilePage(file);
  const data = open(file, (f) => buildLapChart(f, [page.laps[2]], {}));
  assert.equal(data.xUnit, 'm');
  assert.ok(data.x[999] > 4900 && data.x[999] <= 5000);
  fs.rmSync(file);
});

test("two laps: the second is dashed in the first one's colours, and the time difference is charted", () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const [a, b] = [page.laps[2], page.laps[1]]; // lap 2 (58 s) and lap 1 (60 s)
  const data = open(file, (f) =>
    buildLapChart(f, [a, b], { steps: page.steps }),
  );
  const second = data.series.find((s) => s.name === 'LFtempCM L1')!;
  assert.equal(second.dashed, true);
  assert.equal(second.like, 'LFtempCM L2');
  assert.ok(
    !data.series.some((s) => s.name.startsWith('model ')),
    'no model lines in a comparison',
  );
  const delta = data.series.find((s) => s.name.startsWith('time, '))!;
  assert.equal(delta.unit, 's');
  assert.equal(delta.name, 'time, L1 minus L2');
  // Lap 1 is 2 s slower than lap 2: the difference grows from 0 to about 2.
  const first = delta.values.find((v) => v !== null) as number;
  const last = [...delta.values].reverse().find((v) => v !== null) as number;
  assert.ok(Math.abs(first) < 0.1, `starts at ${first}`);
  assert.ok(last > 1.8 && last < 2.2, `ends at ${last}`);
  fs.rmSync(file);
});

test('a bad choice of laps is refused with a reason', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  assert.throws(() => open(file, (f) => buildLapChart(f, [], {})), /one lap/);
  assert.throws(() => renderLapPage(file, page, 99, undefined), /no lap 99/);
  const html = renderLapPage(file, page, 2, 3);
  assert.match(html, /Distance/);
  fs.rmSync(file);
});

test("the tire panel: model zones, pressure and the sim's wear at each point; a lap chart follows the first lap", async () => {
  const { addTirePanel } = await import('../src/chart/tires.ts');
  const { buildChartData } = await import('../src/chart/data.ts');
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const data = open(file, (f) =>
    addTirePanel(buildChartData(f), f, page.steps),
  );
  assert.ok(data.tires);
  const lf = data.tires.corners.lf;
  assert.equal(lf.temp[0].length, data.x.length);
  const at = Math.floor(data.x.length / 2);
  // The model has stepped by the middle of the drive: zones, tread and pressure are numbers.
  assert.ok(lf.temp.every((z) => typeof z[at] === 'number'));
  assert.equal(typeof lf.tread[at], 'number');
  // The fixture's wear reading is 0.97 in every zone: 97 per cent, the sim's, not an estimate.
  assert.deepEqual(
    lf.wear.map((z) => z[at]),
    [97, 97, 97],
  );
  // Ferrari: its dash shows the tire, not a brake disc, so there is no disc level (unknown, not 0).
  assert.equal(lf.disc[at], null);
  // No coldPressure channel in the fixture: pressure is unknown, not 0.
  assert.equal(lf.pressure[at], null);

  const lap = page.laps.find((l) => l.lap === 2)!;
  const lapData = open(file, (f) =>
    addTirePanel(buildLapChart(f, [lap], { steps: page.steps }), f, page.steps),
  );
  assert.equal(lapData.pointRecords!.length, 1000);
  assert.ok(
    lapData.pointRecords!.every((r, i, a) => i === 0 || r >= a[i - 1]),
    'records follow the lap in order',
  );
  assert.ok(
    lapData.pointRecords![0] >= lap.first &&
      lapData.pointRecords![999] <= lap.last,
  );
  assert.ok(
    lapData.tires!.corners.rr.temp[1].some((v) => typeof v === 'number'),
  );
  fs.rmSync(file);
});

test('without steps the panel is not added', async () => {
  const { addTirePanel } = await import('../src/chart/tires.ts');
  const { buildChartData } = await import('../src/chart/data.ts');
  const file = writeLapsIbt();
  const data = open(file, (f) => addTirePanel(buildChartData(f), f, []));
  assert.equal(data.tires, undefined);
  fs.rmSync(file);
});

test('one lap of hundreds of thousands of records does not stop the file from opening', () => {
  // A car sitting in the pits for an hour: the distance never wraps, so it is one segment.
  const rows = Array.from({ length: 200_000 }, (_, i) => ({
    SessionTick: i,
    SessionTime: i / 60,
    LapDistPct: 0.2 + (i % 100) / 1000,
  }));
  const file = path.join(os.tmpdir(), `long-${process.pid}.ibt`);
  fs.writeFileSync(
    file,
    buildIbt({
      yaml: 'WeekendInfo:\n TrackName: t\n',
      vars: [
        { name: 'SessionTick', type: IbtVarType.Int },
        { name: 'SessionTime', type: IbtVarType.Double },
        { name: 'LapDistPct', type: IbtVarType.Float },
      ],
      rows,
    }),
  );
  const laps = open(file, findLaps);
  assert.equal(laps.length, 1);
  assert.equal(laps[0].complete, false);
  fs.rmSync(file);
});
