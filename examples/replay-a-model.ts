/**
 * Replay a model the way the overlay would run it: 15 Hz, live inputs only.
 *   node examples/replay-a-model.ts
 *
 * The "model" here is a smoothing filter that shows the API. It is NOT a tire
 * model and says nothing about iRacing's tires.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { IbtFile } from '../src/ibt/reader.ts';
import { buildIbt } from '../src/ibt/testBuilder.ts';
import { IbtVarType } from '../src/ibt/types.ts';
import type { TireModel } from '../src/model/types.ts';
import { PRODUCTION_HZ, replayModel } from '../src/replay/replay.ts';
import { frames } from '../src/replay/samples.ts';

const zone = (p: string, kind: string) =>
  ['L', 'M', 'R'].map((z) => ({
    name: `${p}${kind}${z}`,
    type: IbtVarType.Float,
  }));

const seconds = 2;
const file = path.join(
  fs.mkdtempSync(path.join(os.tmpdir(), 'tire-lab-')),
  'example.ibt',
);
fs.writeFileSync(
  file,
  buildIbt({
    yaml: 'WeekendInfo:\n TrackName: example\n',
    vars: [
      { name: 'SessionTick', type: IbtVarType.Int },
      { name: 'SessionTime', type: IbtVarType.Double },
      { name: 'Speed', type: IbtVarType.Float },
      ...zone('LF', 'tempC'),
      ...zone('LF', 'temp'), // a surface channel: present in the file, hidden by the live mask
    ],
    rows: Array.from({ length: seconds * 60 }, (_, i) => ({
      SessionTick: i,
      SessionTime: i / 60,
      Speed: 40,
      LFtempCL: 60 + i / 60,
      LFtempCM: 60 + i / 60,
      LFtempCR: 60 + i / 60,
      LFtempL: 90,
      LFtempM: 90,
      LFtempR: 90,
    })),
  }),
);

/** Estimates the left-front carcass by smoothing the measured value. */
const smoother = (): TireModel => {
  let value: number | undefined;
  return {
    reset() {
      value = undefined;
    },
    step(sample) {
      const measured = sample.wheels.lf.carcass?.[1];
      if (measured !== null && measured !== undefined) {
        value =
          value === undefined ? measured : value + 0.5 * (measured - value);
      }
      // No measurement yet: say nothing rather than report 0.
      return value === undefined
        ? { carcass: {} }
        : {
            carcass: {
              lf: { kind: 'estimate', model: 'example-smoother', value },
            },
          };
    },
  };
};

const ibt = IbtFile.open(file);
try {
  const steps = [
    ...replayModel(smoother(), frames(ibt), {
      hz: PRODUCTION_HZ,
      mask: 'live',
    }),
  ];
  const last = steps[steps.length - 1];
  console.log(
    `${steps.length} steps at ${PRODUCTION_HZ} Hz, last dt ${last.dt.toFixed(4)} s`,
  );
  console.log(`last estimate: ${JSON.stringify(last.output.carcass.lf)}`);
} finally {
  ibt.close();
}
