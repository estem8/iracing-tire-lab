import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildIbt } from '../../src/ibt/testBuilder.ts';
import { IbtVarType } from '../../src/ibt/types.ts';

const YAML =
  'DriverInfo:\n DriverCarIdx: 0\n Drivers:\n - CarIdx: 0\n   CarPath: ferrari296gt3\n';
const P = ['LF', 'RF', 'LR', 'RR'];

/** A 30-second drive with the channels the model needs; `withWear: false` leaves the wear channels out. */
export const syntheticIbt = (withWear = true): Buffer =>
  buildIbt({
    yaml: YAML,
    vars: [
      { name: 'SessionTick', type: IbtVarType.Int },
      { name: 'SessionTime', type: IbtVarType.Double },
      { name: 'Speed', type: IbtVarType.Float },
      { name: 'LatAccel', type: IbtVarType.Float },
      { name: 'IsOnTrack', type: IbtVarType.Bool },
      { name: 'AirTemp', type: IbtVarType.Float },
      ...P.flatMap((c) =>
        ['L', 'M', 'R'].flatMap((z) => [
          { name: `${c}tempC${z}`, type: IbtVarType.Float },
          ...(withWear
            ? [{ name: `${c}wear${z}`, type: IbtVarType.Float }]
            : []),
        ]),
      ),
    ],
    rows: Array.from({ length: 1800 }, (_, i) => ({
      SessionTick: i,
      SessionTime: i / 60,
      Speed: 50,
      LatAccel: 10 * Math.sin(i / 90),
      IsOnTrack: 1,
      AirTemp: 20,
      ...Object.fromEntries(
        P.flatMap((c) =>
          ['L', 'M', 'R'].flatMap((z) => [
            [`${c}tempC${z}`, 40],
            ...(withWear ? [[`${c}wear${z}`, 0.97]] : []),
          ]),
        ),
      ),
    })),
  });

/** Writes one to a fresh temp folder and returns its path. */
export const writeSyntheticIbt = (withWear = true, name = 'a.ibt'): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-ibt-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, syntheticIbt(withWear));
  return file;
};

/**
 * A drive of several laps: Lap, LapDistPct (and LapDist in metres when asked)
 * and the tire channels. Lap n takes `lapSeconds[n]` seconds, so the laps differ
 * in time; the first lap starts mid-lap (an out lap) and the last is cut short.
 */
export const lapsIbt = (
  options: {
    lapSeconds?: number[];
    metres?: boolean;
    lapChannel?: boolean;
    /** The session text, for tests that put names in it. */
    yaml?: string;
  } = {},
): Buffer => {
  const {
    lapSeconds = [60, 58, 61],
    metres = false,
    lapChannel = true,
  } = options;
  const hz = 60;
  const rows: Record<string, number>[] = [];
  let tick = 0;
  // Out lap: from 40 % to the line, then whole laps, then 45 % of one more.
  const plan: { lap: number; from: number; to: number; seconds: number }[] = [
    { lap: 0, from: 0.4, to: 1, seconds: 30 },
    ...lapSeconds.map((seconds, i) => ({
      lap: i + 1,
      from: 0,
      to: 1,
      seconds,
    })),
    { lap: lapSeconds.length + 1, from: 0, to: 0.45, seconds: 25 },
  ];
  for (const part of plan) {
    const n = Math.round(part.seconds * hz);
    for (let i = 0; i < n; i++) {
      const pct = part.from + ((part.to - part.from) * i) / n;
      rows.push({
        SessionTick: tick,
        SessionTime: tick / hz,
        Lap: part.lap,
        LapDistPct: Math.min(0.9999, pct),
        LapDist: Math.min(0.9999, pct) * 5000,
        Speed: 40 + 20 * Math.sin(pct * 12) + part.lap,
        LatAccel: 8 * Math.sin(pct * 6),
        IsOnTrack: 1,
        AirTemp: 20,
        ...Object.fromEntries(
          P.flatMap((c) =>
            ['L', 'M', 'R'].flatMap((z) => [
              [`${c}tempC${z}`, 40],
              [`${c}wear${z}`, 0.97],
            ]),
          ),
        ),
      });
      tick++;
    }
  }
  return buildIbt({
    yaml: options.yaml ?? YAML,
    vars: [
      { name: 'SessionTick', type: IbtVarType.Int },
      { name: 'SessionTime', type: IbtVarType.Double },
      ...(lapChannel ? [{ name: 'Lap', type: IbtVarType.Int }] : []),
      { name: 'LapDistPct', type: IbtVarType.Float },
      ...(metres ? [{ name: 'LapDist', type: IbtVarType.Float }] : []),
      { name: 'Speed', type: IbtVarType.Float },
      { name: 'LatAccel', type: IbtVarType.Float },
      { name: 'IsOnTrack', type: IbtVarType.Bool },
      { name: 'AirTemp', type: IbtVarType.Float },
      ...P.flatMap((c) =>
        ['L', 'M', 'R'].flatMap((z) => [
          { name: `${c}tempC${z}`, type: IbtVarType.Float },
          { name: `${c}wear${z}`, type: IbtVarType.Float },
        ]),
      ),
    ],
    rows,
  });
};

export const writeLapsIbt = (
  options: Parameters<typeof lapsIbt>[0] = {},
  name = 'laps.ibt',
): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lab-laps-'));
  const file = path.join(dir, name);
  fs.writeFileSync(file, lapsIbt(options));
  return file;
};
