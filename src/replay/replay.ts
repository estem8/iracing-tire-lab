/**
 * Deterministic replay: the same frames, rate, mask and model give the same
 * steps. The model is reset first, frames are limited to the overlay's tick
 * rate, the mask hides what the live SDK does not send, and `dt` is the real
 * time between the frames kept (0 for the first).
 */
import { applyMask, type InputMask } from '../model/mask.ts';
import type { TireModel, TireOutput } from '../model/types.ts';
import type { ReplayFrame } from './samples.ts';
import { resample } from './schedule.ts';

/** The overlay's tire processor rate (irdashies TireProcessor.tickRateHz). */
export const PRODUCTION_HZ = 15;

export interface ReplayOptions {
  hz: number;
  mask: InputMask;
}

export interface ReplayStep {
  t: number;
  dt: number;
  output: TireOutput;
}

export function* replayModel(
  model: TireModel,
  frames: Iterable<ReplayFrame>,
  options: ReplayOptions,
): Generator<ReplayStep> {
  model.reset();
  let previous: number | undefined;
  for (const frame of resample(frames, options.hz)) {
    const { t } = frame.sample;
    const dt = previous === undefined ? 0 : t - previous;
    previous = t;
    const sample = applyMask({ ...frame.sample, dt }, options.mask);
    yield { t, dt, output: model.step(sample) };
  }
}
