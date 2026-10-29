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
