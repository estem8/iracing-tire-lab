import { readCar, SHOCK_DEFL } from './channels.ts';
import type { Corner, Measured, TireSample, WheelSample } from './types.ts';

/**
 * A telemetry frame the way the overlay holds it: each channel is an object
 * whose `value` is an array, and the first element is the current reading.
 * Any other shape of a channel counts as absent.
 */
export type TelemetryFrame = Readonly<
  Record<string, { readonly value?: readonly unknown[] } | undefined>
>;

const PREFIX: Record<Corner, string> = {
  lf: 'LF',
  rf: 'RF',
  lr: 'LR',
  rr: 'RR',
};
const CORNERS = Object.keys(PREFIX) as Corner[];

const first = (frame: TelemetryFrame, name: string): unknown =>
  frame[name]?.value?.[0];

const num = (frame: TelemetryFrame, name: string): Measured<number> => {
  const v = first(frame, name);
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

const zones = (frame: TelemetryFrame, prefix: string) => {
  const z = ['L', 'M', 'R'].map((s) => num(frame, prefix + s));
  return z[0] === null || z[1] === null || z[2] === null
    ? null
    : ([z[0], z[1], z[2]] as const);
};

/**
 * A telemetry frame as the lab's model input. A channel the frame lacks is
 * null, and a zone triple with a missing zone is null as a whole. `t` is NaN
 * without SessionTime, so the model takes no time step for that frame. `dt` is
 * 0: the model works the step out from the clock itself.
 *
 * Differences from the overlay's own reading, on purpose or by shape: a flag
 * channel counts as set for the boolean true (or the number 1), where the
 * overlay accepts only true; shock travel falls back to the NASCAR name
 * (`LFSHshockDefl`) as the overlay does.
 */
export const fromTelemetryFrame = (frame: TelemetryFrame): TireSample => {
  const wheel = (c: Corner): WheelSample => {
    const p = PREFIX[c];
    return {
      carcass: zones(frame, `${p}tempC`),
      surface: zones(frame, `${p}temp`),
      treadRemaining: zones(frame, `${p}wear`),
      coldPressureKpa: num(frame, `${p}coldPressure`),
      hotPressureKpa: num(frame, `${p}pressure`),
      shockDeflM: num(frame, SHOCK_DEFL[c]) ?? num(frame, `${p}SHshockDefl`),
    };
  };
  const wheels = Object.fromEntries(
    CORNERS.map((c) => [c, wheel(c)]),
  ) as Record<Corner, WheelSample>;
  return {
    t: num(frame, 'SessionTime') ?? NaN,
    dt: 0,
    speed: num(frame, 'Speed'),
    car: readCar((name) => {
      const v = first(frame, name);
      return typeof v === 'number' || typeof v === 'boolean' ? v : null;
    }),
    wheels,
  };
};
