import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { startServer, type AppServer } from '../src/app/server.ts';
import {
  BROADCAST_NAME,
  BROADCAST_TELEM_COMMAND,
  telemetryScript,
  TELEM_MODE,
  type System,
  type TelemetryCommand,
} from '../src/app/system.ts';
import { writeSyntheticIbt } from './helpers/syntheticIbt.ts';

interface Calls {
  telemetry: TelemetryCommand[];
  picks: number;
  running: boolean;
  pick: string | undefined;
}
const fakeSystem = (calls: Calls): System => ({
  canControl: true,
  pickFile: async () => {
    calls.picks++;
    return calls.pick;
  },
  iracingRunning: async () => calls.running,
  telemetry: async (c) => {
    calls.telemetry.push(c);
  },
  openBrowser: async () => undefined,
});

const request = (
  server: AppServer,
  method: string,
  path: string,
  options: {
    headers?: Record<string, string>;
    body?: unknown;
    host?: string;
  } = {},
): Promise<{
  status: number;
  body: string;
  headers: http.IncomingHttpHeaders;
}> =>
  new Promise((resolve, reject) => {
    const body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
    const req = http.request(
      {
        host: '127.0.0.1',
        port: server.port,
        path,
        method,
        headers: {
          host: options.host ?? `127.0.0.1:${server.port}`,
          ...(body !== undefined && {
            'content-length': String(Buffer.byteLength(body)),
          }),
          ...options.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString('utf8'),
            headers: res.headers,
          }),
        );
      },
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });

const withServer = async (
  fn: (server: AppServer, calls: Calls) => Promise<void>,
  onQuit?: () => void,
) => {
  const calls: Calls = {
    telemetry: [],
    picks: 0,
    running: true,
    pick: undefined,
  };
  const server = await startServer(fakeSystem(calls), { onQuit });
  try {
    await fn(server, calls);
  } finally {
    await server.close();
  }
};

const post = (
  server: AppServer,
  path: string,
  body: unknown,
  token = server.token,
) =>
  request(server, 'POST', path, {
    body,
    headers: { 'content-type': 'application/json', 'x-token': token },
  });
const get = (server: AppServer, path: string) =>
  request(server, 'GET', path, { headers: { 'x-token': server.token } });

test('the control page needs the token and the loopback host', async () => {
  await withServer(async (server) => {
    const page = await request(server, 'GET', `/?t=${server.token}`);
    assert.equal(page.status, 200);
    assert.match(page.body, /Record telemetry in iRacing/);
    assert.match(
      String(page.headers['content-security-policy']),
      /default-src 'none'/,
    );
    assert.equal((await request(server, 'GET', '/')).status, 403);
    assert.equal((await request(server, 'GET', '/?t=wrong')).status, 403);
    // DNS rebinding: the right token but another host name.
    const rebound = await request(server, 'GET', `/?t=${server.token}`, {
      host: `evil.example:${server.port}`,
    });
    assert.equal(rebound.status, 403);
  });
});

test('a POST needs JSON and the token header; the token in the address is not enough', async () => {
  await withServer(async (server, calls) => {
    const noHeader = await request(
      server,
      'POST',
      `/api/telemetry?t=${server.token}`,
      {
        body: { command: 'start' },
        headers: { 'content-type': 'application/json' },
      },
    );
    assert.equal(noHeader.status, 403);
    const form = await request(server, 'POST', '/api/telemetry', {
      body: { command: 'start' },
      headers: { 'content-type': 'text/plain', 'x-token': server.token },
    });
    assert.equal(form.status, 415);
    assert.equal(
      (await post(server, '/api/telemetry', { command: 'start' }, 'nope'))
        .status,
      403,
    );
    assert.deepEqual(calls.telemetry, []); // nothing was sent to the game
  });
});

test('the telemetry switch sends start and stop, and nothing else', async () => {
  await withServer(async (server, calls) => {
    assert.equal(
      (await post(server, '/api/telemetry', { command: 'start' })).status,
      200,
    );
    assert.equal(
      (await post(server, '/api/telemetry', { command: 'stop' })).status,
      200,
    );
    assert.equal(
      (await post(server, '/api/telemetry', { command: 'restart' })).status,
      400,
    );
    assert.equal(
      (await post(server, '/api/telemetry', { command: 'rm -rf' })).status,
      400,
    );
    assert.deepEqual(calls.telemetry, ['start', 'stop']);
    const status = JSON.parse((await get(server, '/api/status')).body);
    assert.equal(status.lastCommand, 'stop');
    assert.equal(status.iracing, true);
  });
});

test('status says whether iRacing runs', async () => {
  await withServer(async (server, calls) => {
    calls.running = false;
    assert.equal(
      JSON.parse((await get(server, '/api/status')).body).iracing,
      false,
    );
  });
});

test('opening a file builds its chart, with the model lines when the file allows', async () => {
  await withServer(async (server) => {
    const file = writeSyntheticIbt(true);
    const opened = await post(server, '/api/open', { path: file });
    assert.equal(opened.status, 200);
    const info = JSON.parse(opened.body).file;
    assert.equal(info.records, 1800);
    assert.equal(info.car, 'ferrari296gt3');
    assert.equal(info.hasModel, true);
    const chart = await get(server, '/chart');
    assert.equal(chart.status, 200);
    assert.match(chart.body, /model LF carcass/);
    fs.rmSync(file);
  });
});

test('a file without wear channels still gets its chart, with a note', async () => {
  await withServer(async (server) => {
    const file = writeSyntheticIbt(false);
    const info = JSON.parse(
      (await post(server, '/api/open', { path: file })).body,
    ).file;
    assert.equal(info.hasModel, false);
    assert.match(info.note, /wear/);
    assert.equal((await get(server, '/chart')).status, 200);
    fs.rmSync(file);
  });
});

test('open refuses what is not an .ibt file, a missing file and a bad path; the chart is 404 before any', async () => {
  await withServer(async (server) => {
    assert.equal((await get(server, '/chart')).status, 404);
    assert.equal(
      (await post(server, '/api/open', { path: 'C:\\x\\a.txt' })).status,
      400,
    );
    assert.equal(
      (await post(server, '/api/open', { path: '/nowhere/a.ibt' })).status,
      404,
    );
    assert.equal((await post(server, '/api/open', { path: 42 })).status, 400);
    assert.equal((await post(server, '/api/open', {})).status, 400);
    const broken = writeSyntheticIbt(true, 'broken.ibt');
    fs.writeFileSync(broken, Buffer.alloc(64));
    const res = await post(server, '/api/open', { path: broken });
    assert.equal(res.status, 422);
    assert.ok(JSON.parse(res.body).error.length > 0);
    fs.rmSync(broken);
  });
});

test('the file dialog opens what it returns, and a cancel is not an error', async () => {
  await withServer(async (server, calls) => {
    assert.deepEqual(JSON.parse((await post(server, '/api/pick', {})).body), {
      file: null,
    });
    const file = writeSyntheticIbt(true);
    calls.pick = file;
    const picked = JSON.parse((await post(server, '/api/pick', {})).body);
    assert.equal(picked.file.records, 1800);
    assert.equal(calls.picks, 2);
    fs.rmSync(file);
  });
});

test('quit calls back after answering', async () => {
  let quit = false;
  await withServer(
    async (server) => {
      assert.equal((await post(server, '/api/quit', {})).status, 200);
      await new Promise((r) => setTimeout(r, 20));
      assert.equal(quit, true);
    },
    () => {
      quit = true;
    },
  );
});

test("the telemetry script sends iRacing's message: TelemCommand is 10, start 1, stop 0", () => {
  // From irsdk_defines.h: the 11th irsdk_BroadcastMsg, and irsdk_TelemCommandMode.
  assert.equal(BROADCAST_TELEM_COMMAND, 10);
  assert.deepEqual(TELEM_MODE, { stop: 0, start: 1, restart: 2 });
  const start = telemetryScript('start');
  assert.ok(start.includes(`'${BROADCAST_NAME}'`));
  assert.ok(start.includes('[int]10 -bor ([int]1 -shl 16)'));
  assert.ok(telemetryScript('stop').includes('[int]10 -bor ([int]0 -shl 16)'));
  assert.ok(start.includes('SendNotifyMessage([IntPtr]0xFFFF'));
});

test('tire-lab view writes the chart page next to the file, and a file given alone is viewed', () => {
  const file = writeSyntheticIbt(true);
  const said = execFileSync(
    'node',
    ['src/cli/index.ts', 'view', file, '--no-open'],
    { encoding: 'utf8' },
  );
  assert.match(said, /records/);
  const out = file.replace(/\.ibt$/, '.tire-lab.html');
  assert.match(fs.readFileSync(out, 'utf8'), /model LF carcass/);
  // Dropping a file on the program is the same as `view`.
  fs.rmSync(out);
  execFileSync('node', ['src/cli/index.ts', file], {
    encoding: 'utf8',
    env: { ...process.env, USERPROFILE: '' },
  }).toString();
  fs.rmSync(file);
});

test('laps are listed, and a lap chart is served for one lap or two; bad laps are refused', async () => {
  const { writeLapsIbt } = await import('./helpers/syntheticIbt.ts');
  await withServer(async (server) => {
    const file = writeLapsIbt();
    const info = JSON.parse(
      (await post(server, '/api/open', { path: file })).body,
    ).file;
    assert.deepEqual(
      info.laps.map((l: { lap: number }) => l.lap),
      [0, 1, 2, 3, 4],
    );
    assert.equal(info.laps[1].complete, true);
    assert.ok(Math.abs(info.laps[2].timeS - 58) < 0.05);

    const one = await get(server, '/lapchart?a=2');
    assert.equal(one.status, 200);
    assert.match(one.body, /model LF carcass L2/);
    const two = await get(server, '/lapchart?a=2&b=1');
    assert.equal(two.status, 200);
    assert.match(two.body, /time, L1 minus L2/);
    assert.equal((await get(server, '/lapchart')).status, 400);
    assert.equal((await get(server, '/lapchart?a=x')).status, 400);
    assert.equal((await get(server, '/lapchart?a=99')).status, 422);
    // The token is needed here too.
    assert.equal((await request(server, 'GET', '/lapchart?a=2')).status, 403);
    fs.rmSync(file);
  });
});

test('tire-lab laps lists the laps, and lapchart writes a lap page', async () => {
  const { writeLapsIbt } = await import('./helpers/syntheticIbt.ts');
  const file = writeLapsIbt();
  const list = execFileSync('node', ['src/cli/index.ts', 'laps', file], {
    encoding: 'utf8',
  });
  assert.match(list, /lap   2  0:58\.0\d\d\s+fastest/);
  assert.match(list, /lap   0  partial/);
  const out = file.replace(/\.ibt$/, '.chart.html');
  execFileSync(
    'node',
    [
      'src/cli/index.ts',
      'lapchart',
      file,
      '--lap',
      '2',
      '--compare',
      '1',
      '--out',
      out,
      '--no-open',
    ],
    { encoding: 'utf8' },
  );
  assert.match(fs.readFileSync(out, 'utf8'), /time, L1 minus L2/);
  assert.throws(() =>
    execFileSync('node', ['src/cli/index.ts', 'lapchart', file, '--lap', 'x'], {
      stdio: 'pipe',
    }),
  );
  fs.rmSync(file);
});
