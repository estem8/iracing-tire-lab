/**
 * The app's local server: a control page plus a small JSON API, on 127.0.0.1
 * only. It can open files and send a command to a game, so every request needs
 * a random token (in the page's address, then in a header), the Host header must
 * be the loopback address (against DNS rebinding), and a POST must be JSON with
 * the custom header (a page on another site cannot send that without a CORS
 * preflight, which the server never allows).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { IbtError } from '../ibt/errors.ts';
import { CONTROL_PAGE } from './page.ts';
import type { System, TelemetryCommand } from './system.ts';
import { renderFilePage, renderLapPage, type FilePage } from './viewFile.ts';
import { WORKBENCH_PAGE } from './workbenchPage.ts';
import {
  buildReport,
  issueUrl,
  previewOf,
  ReportError,
  serializeReport,
  type ReportRequest,
} from './report.ts';
import {
  runWorkbench,
  workbenchInfo,
  type WorkbenchRequest,
} from './workbench.ts';

export interface AppServer {
  port: number;
  /** The address to open: it carries the token. */
  url: string;
  token: string;
  close(): Promise<void>;
}

export interface ServerOptions {
  /** 0 or absent: any free port. */
  port?: number;
  /** Called when the page asks to quit. */
  onQuit?: () => void;
  /** How a file becomes a page. Default: the chart with the model. */
  render?: (file: string) => FilePage;
  /** How a lap, or two, becomes a page. Default: by distance, with the model for one lap. */
  renderLaps?: typeof renderLapPage;
  /** Where reports are saved. Default: the folder of the open recording. */
  reportDir?: string;
}

const MAX_BODY = 64 * 1024;
const COMMANDS: readonly TelemetryCommand[] = ['start', 'stop'];

class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const same = (a: string, b: string): boolean => {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const readBody = (req: http.IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'The request is too large'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text === '' ? {} : JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'The request is not valid JSON'));
      }
    });
    req.on('error', reject);
  });

export const startServer = async (
  system: System,
  options: ServerOptions = {},
): Promise<AppServer> => {
  const token = crypto.randomBytes(16).toString('hex');
  const render = options.render ?? renderFilePage;
  const renderLaps = options.renderLaps ?? renderLapPage;
  let current: { name: string; path: string; page: FilePage } | undefined;
  let lastCommand: TelemetryCommand | undefined;
  let bench: string | undefined;
  /** The workbench settings last run, which a report can carry. */
  let benchRequest:
    { values?: Record<string, number>; off?: readonly string[] } | undefined;
  let port = 0;

  const summary = () =>
    current && {
      name: current.name,
      records: current.page.records,
      car: current.page.car ?? null,
      hasModel: current.page.hasModel,
      note: current.page.note ?? null,
      laps: current.page.laps.map((l) => ({
        lap: l.lap,
        startS: l.startS,
        timeS: l.timeS,
        complete: l.complete,
      })),
    };

  const open = (file: unknown) => {
    if (typeof file !== 'string' || file === '' || file.length > 1000)
      throw new HttpError(400, 'Give the path of an .ibt file');
    if (!/\.ibt$/i.test(file))
      throw new HttpError(400, 'Only .ibt files can be opened');
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      throw new HttpError(404, 'That file was not found');
    }
    if (!stat.isFile()) throw new HttpError(400, 'That is not a file');
    try {
      current = { name: path.basename(file), path: file, page: render(file) };
    } catch (e) {
      throw new HttpError(
        422,
        e instanceof IbtError
          ? `${e.code}: ${e.message}`
          : (e as Error).message,
      );
    }
    return summary();
  };

  const handle = async (
    req: http.IncomingMessage,
    res: http.ServerResponse,
  ): Promise<void> => {
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`)
      throw new HttpError(403, 'Forbidden');
    const url = new URL(req.url ?? '/', `http://${host}`);
    const given =
      (req.headers['x-token'] as string | undefined) ??
      url.searchParams.get('t') ??
      '';
    if (!same(given, token)) throw new HttpError(403, 'Forbidden');

    const send = (
      status: number,
      type: string,
      body: string,
      extra: Record<string, string> = {},
    ) => {
      res.writeHead(status, {
        'content-type': type,
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...extra,
      });
      res.end(body);
    };
    const json = (status: number, value: unknown) =>
      send(status, 'application/json; charset=utf-8', JSON.stringify(value));

    if (req.method === 'GET' && url.pathname === '/') {
      return send(200, 'text/html; charset=utf-8', CONTROL_PAGE, {
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'",
      });
    }
    if (req.method === 'GET' && url.pathname === '/chart') {
      if (!current) throw new HttpError(404, 'No file is open yet');
      return send(200, 'text/html; charset=utf-8', current.page.html);
    }
    if (req.method === 'GET' && url.pathname === '/workbench') {
      return send(200, 'text/html; charset=utf-8', WORKBENCH_PAGE, {
        'content-security-policy':
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; frame-src 'self'",
      });
    }
    if (req.method === 'GET' && url.pathname === '/workbench/chart') {
      if (bench === undefined) throw new HttpError(404, 'Run the model first');
      return send(200, 'text/html; charset=utf-8', bench);
    }
    if (req.method === 'GET' && url.pathname === '/api/tuning') {
      if (!current) throw new HttpError(404, 'No file is open yet');
      return json(200, workbenchInfo(current.path, current.page));
    }
    if (req.method === 'GET' && url.pathname === '/lapchart') {
      if (!current) throw new HttpError(404, 'No file is open yet');
      const lapNumber = (name: string): number | undefined => {
        const raw = url.searchParams.get(name);
        if (raw === null || raw === '') return undefined;
        const n = Number(raw);
        if (!Number.isInteger(n))
          throw new HttpError(400, `${name} must be a lap number`);
        return n;
      };
      const a = lapNumber('a');
      if (a === undefined) throw new HttpError(400, 'Pick a lap');
      try {
        const html = renderLaps(current.path, current.page, a, lapNumber('b'));
        return send(200, 'text/html; charset=utf-8', html);
      } catch (e) {
        throw new HttpError(422, (e as Error).message);
      }
    }
    if (req.method === 'GET' && url.pathname === '/api/status') {
      let iracing = false;
      try {
        iracing = await system.iracingRunning();
      } catch {
        // Unknown counts as not running; the page says so.
      }
      return json(200, {
        iracing,
        canControl:
          process.platform === 'win32' || options.render !== undefined,
        lastCommand: lastCommand ?? null,
        file: summary() ?? null,
      });
    }
    if (req.method === 'POST') {
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? ''))
        throw new HttpError(415, 'Send JSON');
      if (!req.headers['x-token']) throw new HttpError(403, 'Forbidden');
      const body = (await readBody(req)) as Record<string, unknown>;
      if (url.pathname === '/api/open')
        return json(200, { file: open(body.path) });
      if (url.pathname === '/api/pick') {
        let picked: string | undefined;
        try {
          picked = await system.pickFile();
        } catch (e) {
          throw new HttpError(501, (e as Error).message);
        }
        return json(200, { file: picked === undefined ? null : open(picked) });
      }
      if (url.pathname === '/api/workbench') {
        if (!current) throw new HttpError(404, 'No file is open yet');
        try {
          const result = runWorkbench(
            current.path,
            current.page,
            body as WorkbenchRequest,
          );
          bench = result.html;
          benchRequest = {
            values: (body as WorkbenchRequest).values,
            off: (body as WorkbenchRequest).off,
          };
          const { html: _html, ...rest } = result;
          void _html;
          return json(200, rest);
        } catch (e) {
          throw new HttpError(422, (e as Error).message);
        }
      }
      if (
        url.pathname === '/api/report/preview' ||
        url.pathname === '/api/report/save'
      ) {
        if (!current) throw new HttpError(404, 'No file is open yet');
        const asked = body as unknown as ReportRequest & {
          includeWorkbench?: boolean;
        };
        const request: ReportRequest = {
          ...asked,
          workbench:
            asked.includeWorkbench === false ? {} : (benchRequest ?? {}),
        };
        let report;
        try {
          report = buildReport(current.page, request);
        } catch (e) {
          throw new HttpError(
            e instanceof ReportError ? 400 : 422,
            (e as Error).message,
          );
        }
        const { gz, rawBytes } = serializeReport(report);
        if (url.pathname === '/api/report/preview')
          return json(200, {
            preview: previewOf(report),
            bytes: gz.length,
            rawBytes,
            hasWorkbench: benchRequest !== undefined,
          });
        const dir = options.reportDir ?? path.dirname(current.path);
        const stamp = new Date()
          .toISOString()
          .replace(/[-:]/g, '')
          .replace(/\..*/, '')
          .replace('T', '-');
        const name = `tire-lab-report-${stamp}.json.gz`;
        const target = path.join(dir, name);
        try {
          fs.writeFileSync(target, gz, { flag: 'wx' });
        } catch (e) {
          throw new HttpError(
            500,
            `The report could not be saved to ${dir}: ${(e as Error).message}`,
          );
        }
        return json(200, {
          path: target,
          name,
          bytes: gz.length,
          issueUrl: issueUrl(report, name),
        });
      }
      if (url.pathname === '/api/telemetry') {
        const command = body.command as TelemetryCommand;
        if (!COMMANDS.includes(command))
          throw new HttpError(400, 'The command must be start or stop');
        try {
          await system.telemetry(command);
        } catch (e) {
          throw new HttpError(501, (e as Error).message);
        }
        lastCommand = command;
        return json(200, { lastCommand });
      }
      if (url.pathname === '/api/quit') {
        json(200, { ok: true });
        setImmediate(() => options.onQuit?.());
        return;
      }
    }
    throw new HttpError(404, 'Not found');
  };

  const server = http.createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      const status = e instanceof HttpError ? e.status : 500;
      if (res.headersSent) return res.end();
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      });
      res.end(
        JSON.stringify({
          error: status === 500 ? 'Something went wrong' : (e as Error).message,
        }),
      );
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port ?? 0, '127.0.0.1', () => resolve());
  });
  port = (server.address() as { port: number }).port;

  return {
    port,
    token,
    url: `http://127.0.0.1:${port}/?t=${token}`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
};
