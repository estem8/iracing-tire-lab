/**
 * The overlay's rate limiter, reproduced so the lab feeds a model the frames
 * production would. Adapted from irdashies (MIT, src/app/processors/ProcessorHost.ts
 * `takeTick` at d421f67; see NOTICE). Runs are spaced 1 / hz from the previous
 * due time, not from the frame that ran, so a rate that does not divide the
 * frame rate still averages hz. The frame itself is taken as is: no averaging
 * between ticks.
 *
 * Re-check against irdashies when it changes: a drift here silently changes
 * what the model is validated on.
 */
export interface TickSchedule {
  lastFrameTime?: number;
  lastRunAt?: number;
  nextDueAt?: number;
}

export const takeTick = (
  schedule: TickSchedule,
  hz: number,
  frameTime: number,
): boolean => {
  // A repeated frame time means a frozen clock; such frames always run.
  if (
    frameTime === schedule.lastRunAt ||
    frameTime === schedule.lastFrameTime
  ) {
    return true;
  }
  const previous = schedule.lastFrameTime;
  schedule.lastFrameTime = frameTime;
  const seekBack = previous !== undefined && frameTime < previous;
  if (
    !seekBack &&
    schedule.nextDueAt !== undefined &&
    frameTime < schedule.nextDueAt - 1e-6
  ) {
    return false;
  }
  const interval = 1 / hz;
  const next =
    schedule.nextDueAt === undefined
      ? undefined
      : schedule.nextDueAt + interval;
  schedule.nextDueAt =
    seekBack || next === undefined || next + interval <= frameTime
      ? frameTime + interval
      : next;
  schedule.lastRunAt = frameTime;
  return true;
};

/** The frames a processor declared at `hz` would see. Lazy, in input order. */
export function* resample<T extends { clock: number }>(
  frames: Iterable<T>,
  hz: number,
): Generator<T> {
  if (!(hz > 0)) throw new RangeError('hz must be positive');
  const schedule: TickSchedule = {};
  for (const frame of frames) {
    if (takeTick(schedule, hz, frame.clock)) yield frame;
  }
}
