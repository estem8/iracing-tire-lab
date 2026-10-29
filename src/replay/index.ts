/** Replaying a model against a recording the way the overlay would run it. */
export {
  PRODUCTION_HZ,
  replayModel,
  type ReplayOptions,
  type ReplayStep,
} from './replay.ts';
export { frames, type ReplayFrame, type SampleBody } from './samples.ts';
export { resample, takeTick, type TickSchedule } from './schedule.ts';
