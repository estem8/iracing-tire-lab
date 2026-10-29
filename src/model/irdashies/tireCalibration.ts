/**
 * Vendored from irdashies (MIT, see NOTICE): src/app/processors/tireCalibration.ts
 * at d421f679dd546758fab92201810b8d26d0ea7974. Do not edit here; see scripts/vendorIrdashies.ts.
 */
import type { Corner as TireCorner } from '../types.ts';
import { MODEL_VERSION } from './tireProfiles.ts';

/** What the thermal model learned about one car on one track. */
export interface TireCalibration {
  /** MODEL_VERSION it was learned under; gains from another model do not apply. */
  model: string;
  gains: Record<TireCorner, number>;
  /** Pit stops that fed the gains. */
  stops: number;
  updatedAt: number;
}

export interface TireCalibrationStore {
  load(key: string): TireCalibration | undefined;
  save(key: string, calibration: TireCalibration): void;
}

/** A saved gain is worth following only inside this range. */
export const GAIN_RANGE = [0.8, 1.2] as const;
const MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
/** Stops after which a saved gain is applied in full. */
const FULL_WEIGHT_STOPS = 3;

/** Gains outside this range mean the model was wrong for the car, not the tire. */
const SAVE_RANGE = [0.5, 2] as const;

/** Whether what the model learned is worth keeping for the next session. */
export const isSavable = (gains: Record<TireCorner, number>) =>
  Object.values(gains).every((g) => g >= SAVE_RANGE[0] && g <= SAVE_RANGE[1]);

export const calibrationKey = (carPath: string, track: string) =>
  `${carPath}|${track}`;

/**
 * The gains to start a session with, or none when the entry is from another
 * model version or too old. Few stops mean a weak estimate, so the gain is
 * pulled back toward 1 until enough of them have been seen.
 */
export const startingGains = (
  saved: TireCalibration | undefined,
  now: number
): Record<TireCorner, number> | undefined => {
  if (
    !saved ||
    saved.model !== MODEL_VERSION ||
    now - saved.updatedAt > MAX_AGE_MS
  ) {
    return undefined;
  }
  const weight = Math.min(1, saved.stops / FULL_WEIGHT_STOPS);
  const start = (gain: number) => {
    const clamped = Math.min(GAIN_RANGE[1], Math.max(GAIN_RANGE[0], gain));
    return 1 + (clamped - 1) * weight;
  };
  return {
    lf: start(saved.gains.lf),
    rf: start(saved.gains.rf),
    lr: start(saved.gains.lr),
    rr: start(saved.gains.rr),
  };
};
