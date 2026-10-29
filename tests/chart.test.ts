import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import {
  buildChartData,
  defaultChannels,
  renderChartHtml,
} from '../src/chart/index.ts';
import { CLIENT_SCRIPT } from '../src/chart/client.ts';
import { IbtFile } from '../src/ibt/reader.ts';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { IbtVarType } from '../src/ibt/types.ts';

const YAML = `---
WeekendInfo:
 TrackName: test track
 TrackAirTemp: 24.00 C
DriverInfo:
 DriverCarIdx: 0
 Drivers:
 - CarIdx: 0
   UserName: Jane Doe
   CarPath: ferrari296gt3
   CarScreenName: Ferrari 296 GT3
`;

const vars = [
  { name: 'SessionTime', type: IbtVarType.Double, unit: 's' },
  { name: 'LFtempCM', type: IbtVarType.Float, unit: 'C' },
  { name: 'RFtempCM', type: IbtVarType.Float, unit: 'C' },
  { name: 'Speed', type: IbtVarType.Float, unit: 'm/s' },
  { name: 'Brake', type: IbtVarType.Float, unit: '%' },
  { name: 'Shock', type: IbtVarType.Float, unit: 'm', count: 3 },
  { name: 'Gear', type: IbtVarType.Int },
];

const makeRows = (n: number, time = (i: number) => i / 60) =>
  Array.from({ length: n }, (_, i) => ({
    SessionTime: time(i),
    LFtempCM: i === 5 ? Number.NaN : 60 + i / 10,
    RFtempCM: 61,
    Speed: 40 + i,
    Brake: 0,
    Shock: [i, i + 1, i + 2],
    Gear: 3,
  }));

const open = (rows = makeRows(120)) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tire-lab-'));
  const file = path.join(dir, 'c.ibt');
  fs.writeFileSync(file, buildIbt({ yaml: YAML, vars, rows }));
  return { file, ibt: IbtFile.open(file) };
};

test('default channels are the tire channels the file records, in a fixed order', () => {
  const { ibt } = open();
  try {
    assert.deepEqual(defaultChannels(ibt), [
      'LFtempCM',
      'RFtempCM',
      'Speed',
      'Brake',
    ]);
  } finally {
    ibt.close();
  }
});

test('units come from the file; a value that is not finite is null, never 0', () => {
  const { ibt } = open();
  try {
    const d = buildChartData(ibt);
    assert.deepEqual(
      d.series.map((s) => [s.name, s.unit]),
      [
        ['LFtempCM', 'C'],
        ['RFtempCM', 'C'],
        ['Speed', 'm/s'],
        ['Brake', '%'],
      ],
    );
    assert.equal(d.series[0].values[5], null);
    assert.equal(d.series[0].values[4], 60.4); // shortest exact text, not 60.400001525
    assert.equal(d.title, 'Ferrari 296 GT3 · test track · air 24.00 C');
    assert.ok(!JSON.stringify(d).includes('Jane'));
  } finally {
    ibt.close();
  }
});

test('thins to the point budget; an array element and a unit-less channel work', () => {
  const { ibt } = open(makeRows(1000));
  try {
    const d = buildChartData(ibt, {
      channels: ['Shock[2]', 'Gear'],
      maxPoints: 100,
    });
    assert.equal(d.stride, 10);
    assert.equal(d.x.length, 100);
    assert.equal(d.series[0].values[3], 32); // record 30: i + 2
    assert.equal(d.series[1].unit, '');
    assert.equal(d.records, 1000);
  } finally {
    ibt.close();
  }
});

test('names every missing channel', () => {
  const { ibt } = open();
  try {
    assert.throws(
      () =>
        buildChartData(ibt, { channels: ['Speed', 'LFtempL', 'LFpressure'] }),
      /LFtempL, LFpressure/,
    );
  } finally {
    ibt.close();
  }
});

test('a clock that jumps back falls back to the record rate so lookups stay valid', () => {
  const { ibt } = open(makeRows(120, (i) => (i < 60 ? i / 60 : 100 - i)));
  try {
    const d = buildChartData(ibt, { channels: ['Speed'] });
    assert.match(d.xName, /not ascending/);
    assert.ok(d.x.every((t, i) => i === 0 || t >= d.x[i - 1]));
  } finally {
    ibt.close();
  }
});

test('the page embeds the data safely: a hostile channel name cannot close the script', () => {
  const hostile = '</script><img src=x onerror=alert(1)>';
  const html = renderChartHtml({
    title: hostile,
    tickRate: 60,
    records: 2,
    stride: 1,
    xName: 'SessionTime',
    x: [0, 1],
    series: [{ name: hostile, unit: 'C', values: [1, null] }],
  });
  assert.ok(!html.includes(hostile));
  const blob =
    /<script type="application\/json" id="data">(.*?)<\/script>/s.exec(html);
  assert.ok(blob);
  const parsed = JSON.parse(blob[1]);
  assert.equal(parsed.series[0].name, hostile); // survives the round trip as text
  assert.deepEqual(parsed.series[0].values, [1, null]);
});

test('the client script parses, and avoids what would break its embedding', () => {
  assert.doesNotThrow(() => new vm.Script(CLIENT_SCRIPT));
  assert.ok(!CLIENT_SCRIPT.includes('`'));
  assert.ok(!CLIENT_SCRIPT.includes('${'));
  assert.ok(!CLIENT_SCRIPT.toLowerCase().includes('</script'));
  assert.ok(!CLIENT_SCRIPT.includes('innerHTML'));
});

test('cli chart writes one page; a missing channel and a missing --out fail clearly', () => {
  const { file, ibt } = open();
  ibt.close();
  const cli = path.resolve('src/cli/index.ts');
  const out = path.join(path.dirname(file), 'chart.html');
  const said = execFileSync('node', [cli, 'chart', file, '--out', out], {
    encoding: 'utf8',
  });
  assert.match(said, /4 series, 120 points/);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.startsWith('<!doctype html>'));
  assert.ok(!/(?:src|href)=["']https?:/.test(html)); // no outside requests

  const run = (...args: string[]) => {
    try {
      execFileSync('node', [cli, 'chart', file, ...args], { stdio: 'pipe' });
      return '';
    } catch (e) {
      return String((e as { stderr?: Buffer }).stderr);
    }
  };
  assert.match(run('--out', out, '--channels', 'Nope'), /missing-channels/);
  assert.match(run(), /usage:/);
});

test('addModelSeries places steps on the chart clock, shares tire colours, leaves gaps as null', async () => {
  const { addModelSeries } = await import('../src/chart/model.ts');
  const data = {
    title: 't',
    tickRate: 60,
    records: 5,
    stride: 1,
    xName: 'SessionTime',
    x: [0, 0.5, 1, 1.5, 4],
    series: [{ name: 'LFtempCM', unit: 'C', values: [1, 2, 3, 4, 5] }],
  };
  const out = (carcass: number) => ({
    carcass: { lf: { kind: 'estimate' as const, model: 'm', value: carcass } },
  });
  const steps = [
    { t: 0.4, phase: 'track' as const, output: out(50) },
    { t: 1.2, phase: 'track' as const, output: out(60) },
  ];
  const next = addModelSeries(data, steps);
  assert.equal(next.series.length, 2);
  assert.equal(data.series.length, 1); // input untouched
  const model = next.series[1];
  assert.equal(model.name, 'model LF carcass');
  assert.equal(model.dashed, true);
  assert.equal(model.like, 'LFtempCM');
  assert.equal(model.unit, 'C');
  // before the first step: null; then the latest step at or before each point;
  // at t=4 the last step (1.2) is 2.8 s old, over the 1 s gap: null again.
  assert.deepEqual(model.values, [null, 50, 50, 60, null]);
  assert.throws(
    () => addModelSeries({ ...data, xName: 'record / tick rate' }, steps),
    /not SessionTime/,
  );
});
