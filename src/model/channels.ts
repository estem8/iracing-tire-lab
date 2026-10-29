/**
 * Which SDK channel each non-tire input comes from. One table, used by the
 * .ibt reader and by the adapter that feeds the overlay's physics, so the two
 * cannot disagree about a name. A channel that is absent is null, never 0.
 * See channels/channels.yaml for which names are verified.
 */
import type { CarSample, Corner, Measured } from './types.ts';

/** What a source can say about one channel: a number, a flag, or nothing. */
export type ChannelGetter = (
  name: string,
) => number | boolean | null | undefined;

const NUMBERS = {
  sessionNum: 'SessionNum',
  pitSvFlags: 'PitSvFlags',
  velocityX: 'VelocityX',
  velocityY: 'VelocityY',
  yawRate: 'YawRate',
  steeringWheelAngle: 'SteeringWheelAngle',
  steeringWheelTorque: 'SteeringWheelTorque',
  latAccel: 'LatAccel',
  longAccel: 'LongAccel',
  vertAccel: 'VertAccel',
  throttle: 'Throttle',
  brake: 'Brake',
  dcBrakeBias: 'dcBrakeBias',
  airTemp: 'AirTemp',
  trackTemp: 'TrackTemp',
  trackTempCrew: 'TrackTempCrew',
  lapCompleted: 'LapCompleted',
  lapDistPct: 'LapDistPct',
} as const;

const FLAGS = {
  isOnTrack: 'IsOnTrack',
  onPitRoad: 'OnPitRoad',
  pitstopActive: 'PitstopActive',
  brakeAbsActive: 'BrakeABSactive',
} as const;

const TIRE_CHANGE = {
  lf: 'dpLFTireChange',
  rf: 'dpRFTireChange',
  lr: 'dpLRTireChange',
  rr: 'dpRRTireChange',
  left: 'dpLTireChange',
  right: 'dpRTireChange',
} as const;

export const SHOCK_DEFL: Record<Corner, string> = {
  lf: 'LFshockDefl',
  rf: 'RFshockDefl',
  lr: 'LRshockDefl',
  rr: 'RRshockDefl',
};

const number = (v: ReturnType<ChannelGetter>): Measured<number> =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const flag = (v: ReturnType<ChannelGetter>): Measured<boolean> =>
  v === true || v === 1 ? true : v === false || v === 0 ? false : null;

export const EMPTY_CAR: CarSample = {
  sessionNum: null,
  pitSvFlags: null,
  velocityX: null,
  velocityY: null,
  yawRate: null,
  steeringWheelAngle: null,
  steeringWheelTorque: null,
  latAccel: null,
  longAccel: null,
  vertAccel: null,
  throttle: null,
  brake: null,
  dcBrakeBias: null,
  airTemp: null,
  trackTemp: null,
  trackTempCrew: null,
  lapCompleted: null,
  lapDistPct: null,
  isOnTrack: null,
  onPitRoad: null,
  pitstopActive: null,
  brakeAbsActive: null,
  tireChange: {
    lf: null,
    rf: null,
    lr: null,
    rr: null,
    left: null,
    right: null,
  },
};

const entries = <T extends object>(o: T) =>
  Object.entries(o) as [keyof T & string, string][];

/** Reads the car-level inputs from any source of channels. */
export const readCar = (get: ChannelGetter): CarSample => {
  const car: Record<string, unknown> = { ...EMPTY_CAR };
  for (const [field, name] of entries(NUMBERS)) car[field] = number(get(name));
  for (const [field, name] of entries(FLAGS)) car[field] = flag(get(name));
  car.tireChange = Object.fromEntries(
    entries(TIRE_CHANGE).map(([k, name]) => [k, number(get(name))]),
  );
  return car as unknown as CarSample;
};

/** The channels a car sample holds, by SDK name; null fields are left out. */
export const carChannels = (
  car: CarSample,
): Record<string, number | boolean> => {
  const out: Record<string, number | boolean> = {};
  for (const [field, name] of entries(NUMBERS)) {
    const v = car[field as keyof typeof NUMBERS];
    if (v !== null) out[name] = v;
  }
  for (const [field, name] of entries(FLAGS)) {
    const v = car[field as keyof typeof FLAGS];
    if (v !== null) out[name] = v;
  }
  for (const [k, name] of entries(TIRE_CHANGE)) {
    const v = car.tireChange[k as keyof typeof TIRE_CHANGE];
    if (v !== null) out[name] = v;
  }
  return out;
};

/** Every channel name this table reads, for the registry check. */
export const CAR_CHANNEL_NAMES: readonly string[] = [
  ...Object.values(NUMBERS),
  ...Object.values(FLAGS),
  ...Object.values(TIRE_CHANGE),
];
