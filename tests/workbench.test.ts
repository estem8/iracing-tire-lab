import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { OverlayModel } from '../src/model/overlayModel.ts';
import {
  applyTuning,
  describeTuning,
  resolveTuning,
  type TuningValues,
} from '../src/model/tuning.ts';
import { profileFor } from '../src/model/irdashies/tireProfiles.ts';
import { startServer, type AppServer } from '../src/app/server.ts';
import type { System } from '../src/app/system.ts';
import { sampleOf } from './golden/sample.ts';
import { stimulus } from './golden/stimulus.ts';
import { writeLapsIbt } from './helpers/syntheticIbt.ts';

const CARS = [
  'ferrari296gt3',
  'cadillacvseriesrgtp',
  'trucks ram2026',
  undefined,
];

const finalTemps = (
  car: string | undefined,
  tuning: TuningValues,
  seconds = 130,
) => {
  const model = new OverlayModel(car, { tuning });
  let last = {} as Record<string, number>;
  for (const f of stimulus('base')) {
    if ((f.SessionTime as number) > seconds) break;
    const out = model.step(sampleOf(f));
    last = Object.fromEntries(
      (['lf', 'rf', 'lr', 'rr'] as const).flatMap((c) => [
        [`${c}.carcass`, out.carcass[c]?.value ?? NaN],
        [`${c}.tread`, out.tread?.[c]?.value ?? NaN],
      ]),
    );
  }
  return last;
};

test('every component says what it is, how it is computed and what it reads; ids are unique', () => {
  for (const car of CARS) {
    const d = describeTuning(car);
    assert.ok(
      d.components.length >= 10,
      `${car}: ${d.components.length} components`,
    );
    const ids = new Set<string>();
    for (const c of d.components) {
      assert.ok(
        c.what.length > 20 && c.how.length > 20,
        `${c.id} is described`,
      );
      assert.ok(c.params.length > 0);
      for (const p of c.params) {
        assert.ok(!ids.has(p.id), `duplicate ${p.id}`);
        ids.add(p.id);
        assert.ok(p.description.length > 10, `${p.id} has a description`);
        assert.ok(Number.isFinite(p.default) && p.max > p.min, p.id);
      }
      if (c.switchable)
        assert.ok(
          c.params.some((p) => p.off !== undefined),
          `${c.id} is switchable but has nothing to switch`,
        );
    }
  }
});

test('which model shows the number is said, and follows the car', () => {
  assert.match(describeTuning('ferrari296gt3').shownBy, /surface model/);
  assert.match(describeTuning('bmwm4gt3').shownBy, /surface model/);
  assert.match(
    describeTuning('cadillacvseriesrgtp').shownBy,
    /slow thermal model/,
  );
  assert.match(describeTuning('trucks ram2026').shownBy, /slow thermal model/);
});

test("the registry's defaults are the code's: running with every default given is the same as running with none", () => {
  for (const car of CARS) {
    const all: Record<string, number> = {};
    for (const c of describeTuning(car).components)
      for (const p of c.params) all[p.id] = p.default;
    assert.deepEqual(finalTemps(car, all), finalTemps(car, {}), String(car));
  }
});

test('resolve: unknown names, non-numbers and components that cannot be switched are refused; off sets the coefficients to zero', () => {
  assert.throws(
    () => resolveTuning('ferrari296gt3', { values: { 'surface.nope': 1 } }),
    /Unknown parameter/,
  );
  assert.throws(
    () => resolveTuning('ferrari296gt3', { values: { 'surface.wSlip': NaN } }),
    /number/,
  );
  assert.throws(
    () => resolveTuning('ferrari296gt3', { off: ['nope'] }),
    /Unknown component/,
  );
  assert.throws(
    () => resolveTuning('ferrari296gt3', { off: ['cooling'] }),
    /cannot be switched off/,
  );
  assert.deepEqual(resolveTuning('ferrari296gt3', { off: ['braking'] }), {
    'surface.wBraking': 0,
  });
  // A value given and a switch-off for the same parameter: off wins.
  assert.deepEqual(
    resolveTuning('ferrari296gt3', {
      values: { 'surface.wBraking': 5 },
      off: ['braking'],
    }),
    { 'surface.wBraking': 0 },
  );
  // Thermal nested names, on a car that has them.
  const t = resolveTuning('ferrari296gt3', { off: ['t-scrub', 't-bank'] });
  assert.equal(t['thermal.scrub.heat'], 0);
  assert.equal(t['thermal.bank.heat'], 0);
});

test('applying values changes a copy, never the shared profile', () => {
  const before = JSON.stringify(profileFor('ferrari296gt3').thermal);
  const out = applyTuning(profileFor('ferrari296gt3'), {
    'thermal.heat': 1,
    'thermal.scrub.heat': 2,
    'thermal.carcass.k': 3,
    'surface.wSlip': 4,
    'env.trackShare': 0.5,
    'start.staleStart': 50,
  });
  assert.equal(out.profile.thermal.heat, 1);
  assert.equal(out.profile.thermal.scrub?.heat, 2);
  assert.equal(out.profile.thermal.carcass?.k, 3);
  assert.equal(out.profile.staleStart, 50);
  assert.equal(out.surface.wSlip, 4);
  assert.equal(out.trackShare, 0.5);
  assert.equal(JSON.stringify(profileFor('ferrari296gt3').thermal), before);
});

test('switching a component off lowers the estimate the way its description says', () => {
  const base = finalTemps('ferrari296gt3', {});
  const noBulkHeat = (off: string[]) =>
    finalTemps('ferrari296gt3', resolveTuning('ferrari296gt3', { off }));
  // The default GT3 shows the surface model's bulk node: its heat terms matter, the slow model's do not.
  assert.ok(
    noBulkHeat(['bulk-hysteresis'])['lf.carcass'] < base['lf.carcass'] - 3,
    'rolling heat off cools the bulk',
  );
  assert.ok(
    noBulkHeat(['cornering'])['rf.tread'] < base['rf.tread'] - 1,
    'cornering heat off cools the outside tread',
  );
  assert.ok(
    noBulkHeat(['braking'])['lf.tread'] < base['lf.tread'],
    'braking heat off cools the front tread',
  );
  assert.equal(
    noBulkHeat(['t-cornering'])['lf.carcass'],
    base['lf.carcass'],
    'the slow model does not show on a GT3',
  );
  // The Cadillac shows the slow model, so its components decide the number.
  const cad = finalTemps('cadillacvseriesrgtp', {});
  const cadOff = finalTemps(
    'cadillacvseriesrgtp',
    resolveTuning('cadillacvseriesrgtp', { off: ['t-cornering'] }),
  );
  assert.ok(cadOff['rf.carcass'] < cad['rf.carcass'] - 3);
  assert.equal(
    finalTemps(
      'cadillacvseriesrgtp',
      resolveTuning('cadillacvseriesrgtp', { off: ['cornering'] }),
    )['rf.carcass'],
    cad['rf.carcass'],
    'the surface model does not show on the Cadillac',
  );
});

test('more cooling lowers the temperature, and a changed constant moves only what it feeds', () => {
  const base = finalTemps('ferrari296gt3', {});
  const cooler = finalTemps('ferrari296gt3', { 'surface.c1': 0.02 });
  assert.ok(cooler['lf.tread'] < base['lf.tread'] - 2);
  const hotterAir = finalTemps('ferrari296gt3', { 'env.trackShare': 1 }); // TrackTemp 32 vs air 22
  assert.ok(hotterAir['lf.carcass'] > base['lf.carcass']);
});

// ----------------------------------------------------------------- server

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
  path: string,
  body?: unknown,
): Promise<{ status: number; body: string }> =>
  new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method,
        headers: {
          host: `127.0.0.1:${server.port}`,
          'x-token': server.token,
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

test('the workbench: info needs an open file; a run charts recorded, default and tuned lines; bad requests are refused', async () => {
  const server = await startServer(fakeSystem);
  const file = writeLapsIbt();
  try {
    assert.equal((await call(server, 'GET', '/api/tuning')).status, 404);
    assert.equal((await call(server, 'GET', '/workbench/chart')).status, 404);
    await call(server, 'POST', '/api/open', { path: file });

    const info = JSON.parse((await call(server, 'GET', '/api/tuning')).body);
    assert.match(info.description.shownBy, /surface model/);
    assert.equal(info.availability.Speed.present, true);
    assert.equal(
      info.availability.LongAccel.present,
      false,
      'the fixture has no LongAccel: said, not hidden',
    );
    assert.ok(
      info.channels.some((c: { name: string }) => c.name === 'LFtempCM'),
    );
    assert.ok(info.defaultChannels.includes('LFtempCM'));

    const run = await call(server, 'POST', '/api/workbench', {
      off: ['braking', 'cornering'],
      values: { 'surface.c1': 0.01 },
    });
    assert.equal(run.status, 200);
    const result = JSON.parse(run.body);
    assert.equal(result.values['surface.wBraking'], 0);
    assert.equal(result.values['surface.c1'], 0.01);
    assert.equal(result.difference.length, 4);
    assert.ok(result.difference[0].stats.n > 100);
    assert.ok(
      result.difference[0].stats.mae > 0,
      'the changed model differs from the default',
    );
    const chart = (await call(server, 'GET', '/workbench/chart')).body;
    for (const name of [
      'default LF carcass',
      'tuned LF carcass',
      'LFtempCM',
      'Speed',
    ])
      assert.match(chart, new RegExp(name));
    assert.match(chart, /"dotted":true/);

    // Nothing changed: the tuned model is the default one.
    const same = JSON.parse(
      (await call(server, 'POST', '/api/workbench', {})).body,
    );
    assert.equal(same.difference[0].stats.max, 0);

    // A channel of the user's choosing.
    const picked = await call(server, 'POST', '/api/workbench', {
      channels: ['AirTemp', 'LFtempCM'],
    });
    assert.equal(picked.status, 200);
    assert.match(
      (await call(server, 'GET', '/workbench/chart')).body,
      /AirTemp/,
    );

    assert.equal(
      (
        await call(server, 'POST', '/api/workbench', {
          values: { 'surface.nope': 1 },
        })
      ).status,
      422,
    );
    assert.equal(
      (await call(server, 'POST', '/api/workbench', { off: ['cooling'] }))
        .status,
      422,
    );
    assert.equal(
      (
        await call(server, 'POST', '/api/workbench', {
          channels: ['NoSuchChannel'],
        })
      ).status,
      422,
    );
    assert.equal(
      (
        await call(server, 'POST', '/api/workbench', {
          channels: ['a"><script>'],
        })
      ).status,
      422,
    );
    const page = (await call(server, 'GET', '/workbench')).body;
    assert.match(page, /sandbox="allow-scripts"/);
  } finally {
    await server.close();
    fs.rmSync(file);
  }
});
