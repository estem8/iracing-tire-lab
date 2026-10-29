/**
 * Which inputs a model may see.
 *
 * A recording (.ibt) can hold channels the overlay never receives live, so a
 * model judged on a full recording may not work in the overlay. Judge it with
 * the `live` mask, which removes everything the live SDK is not known to send.
 *
 * PROVISIONAL: the live set below comes from one live SDK dump (see
 * channels/channels.yaml: the surface temperature and hot pressure channels
 * were absent from it). It does not yet model that the live carcass and wear
 * readings reportedly stay frozen between pit stops; that is unverified and is
 * a separate transform to add once a recording shows it.
 */
import type { TireSample, WheelSample } from './types.ts';

export type InputMask = 'all' | 'live';

const WHEEL_FIELDS_NOT_LIVE = ['surface', 'hotPressureKpa'] as const;

const maskWheel = (wheel: WheelSample): WheelSample => {
  const out: WheelSample = { ...wheel };
  for (const field of WHEEL_FIELDS_NOT_LIVE) out[field] = null;
  return out;
};

/** A copy of the sample with the masked fields set to null (unknown, never 0). */
export const applyMask = (sample: TireSample, mask: InputMask): TireSample => {
  if (mask === 'all') return sample;
  return {
    ...sample,
    wheels: {
      lf: maskWheel(sample.wheels.lf),
      rf: maskWheel(sample.wheels.rf),
      lr: maskWheel(sample.wheels.lr),
      rr: maskWheel(sample.wheels.rr),
    },
  };
};
