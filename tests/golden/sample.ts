import { readCar } from '../../src/model/channels.ts';
import type { Corner, TireSample, WheelSample } from '../../src/model/types.ts';
import type { StimulusFrame } from './stimulus.ts';

const PREFIX: Record<Corner, string> = {
  lf: 'LF',
  rf: 'RF',
  lr: 'LR',
  rr: 'RR',
};

/** A stimulus frame as the lab's input contract: what the .ibt reader would give for those channels. */
export const sampleOf = (frame: StimulusFrame): TireSample => {
  const get = (name: string) => frame[name];
  const one = (name: string) => {
    const v = frame[name];
    return typeof v === 'number' ? v : null;
  };
  const zones = (prefix: string) => {
    const z = ['L', 'M', 'R'].map((s) => one(prefix + s));
    return z.every((v) => v !== null) ? (z as [number, number, number]) : null;
  };
  const wheel = (c: Corner): WheelSample => ({
    carcass: zones(`${PREFIX[c]}tempC`),
    surface: zones(`${PREFIX[c]}temp`),
    treadRemaining: zones(`${PREFIX[c]}wear`),
    coldPressureKpa: one(`${PREFIX[c]}coldPressure`),
    hotPressureKpa: one(`${PREFIX[c]}pressure`),
    shockDeflM: one(`${PREFIX[c]}shockDefl`),
  });
  return {
    t: frame.SessionTime as number,
    dt: 0,
    speed: one('Speed'),
    car: readCar(get),
    wheels: {
      lf: wheel('lf'),
      rf: wheel('rf'),
      lr: wheel('lr'),
      rr: wheel('rr'),
    },
  };
};
