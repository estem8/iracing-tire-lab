/**
 * Deterministic replay: the same frames, rates, mask and model give the same
 * steps. The model is reset first and is given what the overlay's tire
 * processor would be given:
 *
 *   sim records (60 Hz)
 *     -> frames reaching the processors (about 20 Hz in the app)
 *     -> the processor's own tick rate (15 Hz), chosen by the overlay's takeTick
 *     -> the live input mask
 *
 * so `dt` is the real time between the frames kept (0 for the first), and it
 * alternates, 50 and 100 ms for 15 Hz picked from 20 Hz.
 */
import { applyMask, type InputMask } from '../model/mask.ts';
import type { TireModel, TireOutput, TireSample } from '../model/types.ts';
import type { ReplayFrame } from './samples.ts';
import { resample } from './schedule.ts';

/** The overlay's tire processor rate (irdashies TireProcessor.tickRateHz). */
export const PRODUCTION_HZ = 15;

/**
 * How often frames reach the processors in the app. irdashies' performance
 * harness measured 21 Hz on a recorded tape (docs/PERFORMANCE_TEST_LOG.md);
 * 20 is the nearest rate that divides the sim's 60. A live game, or a build
 * with a different telemetry loop, may differ: pass your own `arrivalHz`.
 */
export const APP_ARRIVAL_HZ = 20;

export interface ReplayOptions {
  /** The processor's tick rate. */
  hz: number;
  mask: InputMask;
  /**
   * Frames per second that reach the processor. Default APP_ARRIVAL_HZ. Pass
   * the recording's own rate (60) to skip this stage.
   */
  arrivalHz?: number;
}

export interface ReplayStep {
  t: number;
  dt: number;
  output: TireOutput;
}

/** The samples a model would be given, in order. Lazy and deterministic. */
export function* modelInputs(
  frames: Iterable<ReplayFrame>,
  options: ReplayOptions,
): Generator<TireSample> {
  const { hz, mask, arrivalHz = APP_ARRIVAL_HZ } = options;
  let previous: number | undefined;
  for (const frame of resample(resample(frames, arrivalHz), hz)) {
    const { t } = frame.sample;
    const dt = previous === undefined ? 0 : t - previous;
    previous = t;
    yield applyMask({ ...frame.sample, dt }, mask);
  }
}

export function* replayModel(
  model: TireModel,
  frames: Iterable<ReplayFrame>,
  options: ReplayOptions,
): Generator<ReplayStep> {
  model.reset();
  for (const sample of modelInputs(frames, options)) {
    yield { t: sample.t, dt: sample.dt, output: model.step(sample) };
  }
}
