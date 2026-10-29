import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { startServer, type AppServer } from '../src/app/server.ts';
import { renderFilePage } from '../src/app/viewFile.ts';
import {
  buildReport,
  FIELDS,
  issueUrl,
  previewOf,
  readReport,
  replayReport,
  serializeReport,
  ReportError,
} from '../src/app/report.ts';
import { LAB_VERSION } from '../src/version.ts';
import type { System } from '../src/app/system.ts';
import { writeLapsIbt } from './helpers/syntheticIbt.ts';

test("the version in reports is the package's", () => {
  assert.equal(
    LAB_VERSION,
    JSON.parse(fs.readFileSync('package.json', 'utf8')).version,
  );
});

const request = {
  kind: 'mismatch' as const,
  t: 100,
  observed: [
    {
      corner: 'lf' as const,
      quantity: 'carcass' as const,
      value: 80,
      source: 'dash' as const,
    },
  ],
  note: 'looks cold after the first corner',
};

test('a report holds the run from the start of the session to the moment, and no session text', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const report = buildReport(page, request);
  assert.equal(
    report.series.from,
    0,
    'the whole run from the start, not a window: the temperature accumulates',
  );
  assert.ok(report.series.to >= 100 && report.series.to <= 110.1);
  assert.equal(report.series.t.length, report.series.count);
  assert.ok(
    report.series.columns.every((c) => c.length === report.series.count),
  );
  assert.equal(report.series.fields.length, FIELDS.length);
  assert.equal(report.car, 'ferrari296gt3');
  assert.equal(report.moment.t, 100);
  assert.ok(report.modelAtMoment.lf?.carcass !== undefined);
  assert.ok(report.channels.some((c) => c.name === 'LFtempCM'));
  // No personal text: the session YAML is not in it, and the file path is not either.
  const text = JSON.stringify(report);
  assert.ok(!text.includes(path.dirname(file)));
  assert.ok(!/DriverInfo|UserName|TeamName|UserID/.test(text));
  assert.deepEqual(
    Object.keys(JSON.parse(JSON.stringify(report.session))).sort(),
    ['carPath'],
  );
  fs.rmSync(file);
});

test('a second session starts a new run', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  // Pretend the second half of the recording is another session.
  const half = Math.floor(page.samples.length / 2);
  page.samples.forEach((s, i) => {
    s.car = { ...s.car, sessionNum: i < half ? 0 : 1 };
  });
  const t = page.samples[half + 100].t;
  const report = buildReport(page, { kind: 'bug', t });
  assert.equal(
    report.series.from,
    Math.round(page.samples[half].t * 1000) / 1000,
  );
  fs.rmSync(file);
});

test('saved and read back, a report gives the same model value at the moment, within the rounding of the inputs', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const report = buildReport(page, request);
  const { gz, rawBytes } = serializeReport(report);
  assert.ok(gz.length < rawBytes / 3, 'it compresses');
  const back = readReport(gz);
  assert.deepEqual(back.series.fields, report.series.fields);
  const replay = replayReport(back);
  assert.ok(
    replay.roundingGap < 0.1,
    `rounding moved the model by ${replay.roundingGap} C`,
  );
  const lf = replay.observed[0];
  assert.equal(lf.corner, 'lf');
  assert.ok(
    lf.unchanged !== null &&
      Math.abs(lf.unchanged - (report.modelAtMoment.lf?.carcass as number)) <
        0.1,
  );
  assert.equal(lf.unchangedError, Math.round((lf.unchanged! - 80) * 100) / 100);
  // No settings changed: the tuned run is the unchanged one.
  assert.equal(lf.tuned, lf.unchanged);
  fs.rmSync(file);
});

test('the workbench settings travel with the report and change the replay', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const report = buildReport(page, {
    ...request,
    workbench: { off: ['bulk-hysteresis'], values: { 'surface.c1': 0.01 } },
  });
  assert.equal(report.workbench.values['surface.wbLoad'], 0);
  assert.equal(report.workbench.values['surface.c1'], 0.01);
  assert.deepEqual(report.workbench.off, ['bulk-hysteresis']);
  const replay = replayReport(readReport(serializeReport(report).gz));
  assert.ok(
    replay.observed[0].tuned! < replay.observed[0].unchanged! - 1,
    'the settings cool the bulk',
  );
  fs.rmSync(file);
});

test('bad requests are refused with a reason; text is bounded', () => {
  const file = writeLapsIbt();
  const page = renderFilePage(file);
  const bad = (patch: object, re: RegExp) =>
    assert.throws(
      () => buildReport(page, { ...request, ...patch } as never),
      (e) => e instanceof ReportError && re.test(e.message),
    );
  bad({ kind: 'spam' }, /kind/);
  bad({ t: -1 }, /session time/);
  bad({ t: 'x' }, /session time/);
  bad(
    {
      observed: [
        { corner: 'xx', quantity: 'carcass', value: 1, source: 'dash' },
      ],
    },
    /corner/,
  );
  bad(
    {
      observed: [{ corner: 'lf', quantity: 'wear', value: 1, source: 'dash' }],
    },
    /quantity/,
  );
  bad(
    {
      observed: [
        { corner: 'lf', quantity: 'carcass', value: null, source: 'dash' },
      ],
    },
    /value/,
  );
  bad(
    {
      observed: [
        { corner: 'lf', quantity: 'carcass', value: 1, source: 'rumour' },
      ],
    },
    /source/,
  );
  assert.equal(
    buildReport(page, { ...request, note: 'x'.repeat(5000) }).note.length,
    2000,
  );
  assert.equal(
    buildReport(page, {
      ...request,
      observed: Array(20).fill(request.observed[0]),
    }).observed.length,
    8,
  );
  fs.rmSync(file);
});

test('readReport refuses what is not a report', () => {
  assert.throws(() => readReport(Buffer.from('not json')), /not a report/);
  assert.throws(
    () => readReport(Buffer.from('{"schema":2}')),
    /Unknown report version/,
  );
  assert.throws(
    () =>
      readReport(
        zlib.gzipSync(
          '{"schema":1,"series":{"t":[1],"fields":["car.x"],"columns":[[1]]}}',
        ),
      ),
    /column this version does not know/,
  );
  assert.throws(
    () =>
      readReport(
        zlib.gzipSync(
          '{"schema":1,"series":{"t":[1,2],"fields":["speed"],"columns":[[1]]}}',
        ),
      ),
    /malformed/,
  );
});

test('the preview shows everything but the long series, and says what the series is', () => {
  const file = writeLapsIbt();
  const preview = previewOf(
    buildReport(renderFilePage(file), request),
  ) as Record<string, any>;
  assert.equal(preview.note, request.note);
  assert.equal(preview.observed.length, 1);
  assert.match(preview.series.numbers, /No names, ids, dates or text/);
  assert.equal(preview.series.columns, undefined);
  assert.match(preview.channels, /channels/);
  fs.rmSync(file);
});

test("the issue address is the repository's, short, and carries the case", () => {
  const file = writeLapsIbt();
  const url = issueUrl(buildReport(renderFilePage(file), request), 'r.json.gz');
  assert.ok(
    url.startsWith('https://github.com/estem8/iracing-tire-lab/issues/new?'),
  );
  const q = new URL(url).searchParams;
  assert.equal(q.get('template'), 'mismatch.yml');
  assert.match(q.get('seen')!, /LF carcass: game 80, dash/);
  assert.match(q.get('seen')!, /r\.json\.gz/);
  assert.ok(url.length < 2000);
  fs.rmSync(file);
});

// ------------------------------------------------------------------ server and CLI

const fakeSystem: System = {
  canControl: true,
  pickFile: async () => undefined,
  iracingRunning: async () => false,
  telemetry: async () => undefined,
  openBrowser: async () => undefined,
};
const call = (
  server: AppServer,
  method: string,
  p: string,
  body?: unknown,
  token = server.token,
) =>
  new Promise<{ status: number; body: string }>((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path: p,
        method,
        headers: {
          host: `127.0.0.1:${server.port}`,
          'x-token': token,
          ...(data !== undefined && {
            'content-type': 'application/json',
            'content-length': String(Buffer.byteLength(data)),
          }),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        );
      },
    );
    req.on('error', reject);
    if (data !== undefined) req.write(data);
    req.end();
  });

test('the app previews, saves and does not overwrite; the CLI replays the saved file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reports-'));
  const server = await startServer(fakeSystem, { reportDir: dir });
  const file = writeLapsIbt();
  try {
    assert.equal(
      (await call(server, 'POST', '/api/report/preview', request)).status,
      404,
      'no file yet',
    );
    await call(server, 'POST', '/api/open', { path: file });
    assert.equal(
      (await call(server, 'POST', '/api/report/preview', { ...request, t: -5 }))
        .status,
      400,
    );

    const prev = await call(server, 'POST', '/api/report/preview', request);
    assert.equal(prev.status, 200);
    const p = JSON.parse(prev.body);
    assert.ok(p.bytes > 1000 && p.rawBytes > p.bytes);
    assert.equal(p.hasWorkbench, false);
    assert.deepEqual(fs.readdirSync(dir), [], 'a preview writes nothing');

    // Run the workbench with a setting; the report then carries it.
    await call(server, 'POST', '/api/workbench', { off: ['braking'] });
    const saved = await call(server, 'POST', '/api/report/save', request);
    assert.equal(saved.status, 200);
    const s = JSON.parse(saved.body);
    assert.equal(path.dirname(s.path), dir);
    assert.match(s.name, /^tire-lab-report-\d{8}-\d{6}\.json\.gz$/);
    assert.ok(
      s.issueUrl.startsWith(
        'https://github.com/estem8/iracing-tire-lab/issues/new?',
      ),
    );
    const report = readReport(fs.readFileSync(s.path));
    assert.equal(report.workbench.values['surface.wBraking'], 0);
    // The choice not to include them is honoured.
    const without = JSON.parse(
      (
        await call(server, 'POST', '/api/report/preview', {
          ...request,
          includeWorkbench: false,
        })
      ).body,
    );
    assert.deepEqual(without.preview.workbench.off, []);

    const said = execFileSync(
      'node',
      ['src/cli/index.ts', 'replay-report', s.path],
      { encoding: 'utf8' },
    );
    assert.match(said, /mismatch: ferrari296gt3/);
    assert.match(
      said,
      /LF carcass: game 80 \(dash\) \| model [\d.]+ \(error -?[\d.]+\)/,
    );
    assert.match(said, /workbench settings: \{"surface.wBraking":0\}/);
    assert.match(said, /differs from the sender's by at most/);
    assert.throws(
      () =>
        execFileSync('node', ['src/cli/index.ts', 'replay-report', file], {
          stdio: 'pipe',
        }),
      /not a report/,
    );

    assert.equal(
      (await call(server, 'POST', '/api/report/save', request, 'wrong')).status,
      403,
    );
  } finally {
    await server.close();
    fs.rmSync(file);
    fs.rmSync(dir, { recursive: true });
  }
});
