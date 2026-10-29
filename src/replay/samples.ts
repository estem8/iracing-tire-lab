/**
 * Turns the records of an .ibt into the model's input stream.
 *
 * The channel names below are the lab's reading of the SDK names; see
 * channels/channels.yaml for which are verified. A channel the file does not
 * record becomes null, never 0, and a zone triple with a missing zone is null
 * as a whole.
 */
import { readVarValue } from '../ibt/binary.ts';
import { SHOCK_DEFL, readCar } from '../model/channels.ts';
import type { IbtFile } from '../ibt/reader.ts';
import type { IbtVarHeader } from '../ibt/types.ts';
import type {
  Corner,
  Measured,
  TireSample,
  WheelSample,
  Zones,
} from '../model/types.ts';

export type SampleBody = Omit<TireSample, 'dt'>;

/** A record as the overlay's scheduler sees it: a clock and the values. */
export interface ReplayFrame {
  /** Seconds, from SessionTick / 60 (the overlay's frame clock). */
  clock: number;
  sample: SampleBody;
}

const PREFIX: Record<Corner, string> = {
  lf: 'LF',
  rf: 'RF',
  lr: 'LR',
  rr: 'RR',
};
const CORNERS = Object.keys(PREFIX) as Corner[];
const ZONES = ['L', 'M', 'R'] as const;

type Header = IbtVarHeader | undefined;

export const frames = function* (file: IbtFile): Generator<ReplayFrame> {
  const scalar = (name: string): Header => file.channel(name);
  const time = scalar('SessionTime');
  const tick = scalar('SessionTick');
  const speed = scalar('Speed');

  const triple = (prefix: string): Header[] =>
    ZONES.map((z) => scalar(prefix + z));
  const wheels = Object.fromEntries(
    CORNERS.map((c) => {
      const p = PREFIX[c];
      return [
        c,
        {
          carcass: triple(`${p}tempC`),
          surface: triple(`${p}temp`),
          wear: triple(`${p}wear`),
          cold: scalar(`${p}coldPressure`),
          hot: scalar(`${p}pressure`),
        },
      ];
    }),
  );

  const shock = Object.fromEntries(
    CORNERS.map((c) => [c, scalar(SHOCK_DEFL[c])]),
  ) as Record<Corner, Header>;
  const carHeaders = new Map<string, Header>();
  const carHeader = (name: string): Header => {
    if (!carHeaders.has(name)) carHeaders.set(name, scalar(name));
    return carHeaders.get(name);
  };

  const one = (rec: Buffer, h: Header): Measured<number> => {
    if (!h) return null;
    const v = readVarValue(rec, h);
    return Number.isFinite(v) ? v : null;
  };
  const zones = (rec: Buffer, hs: Header[]): Measured<Zones> => {
    const v = hs.map((h) => one(rec, h));
    return v[0] === null || v[1] === null || v[2] === null
      ? null
      : ([v[0], v[1], v[2]] as const);
  };

  for (let i = 0; i < file.recordCount; i++) {
    const rec = file.readRecord(i);
    const clock =
      one(rec, tick) !== null
        ? (one(rec, tick) as number) / 60
        : i / Math.max(1, file.header.tickRate);
    const out = Object.fromEntries(
      CORNERS.map((c): [Corner, WheelSample] => {
        const w = wheels[c];
        return [
          c,
          {
            carcass: zones(rec, w.carcass),
            surface: zones(rec, w.surface),
            treadRemaining: zones(rec, w.wear),
            coldPressureKpa: one(rec, w.cold),
            hotPressureKpa: one(rec, w.hot),
            shockDeflM: one(rec, shock[c]),
          },
        ];
      }),
    ) as Record<Corner, WheelSample>;
    yield {
      clock,
      sample: {
        t: one(rec, time) ?? clock,
        speed: one(rec, speed),
        car: readCar((name) => {
          const h = carHeader(name);
          return h ? one(rec, h) : undefined;
        }),
        wheels: out,
      },
    };
  }
};
