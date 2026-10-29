/** Error metrics: how far a model is from reference values. Pure, no I/O. */
export { errorStats, type ErrorStats } from './stats.ts';
export {
  parseReference,
  KINDS,
  QUANTITIES,
  type Kind,
  type Quantity,
  type Reading,
  type Reference,
} from './reference.ts';
export {
  formatScore,
  score,
  scoreSteps,
  type Group,
  type Phase,
  type Score,
  type ScoreOptions,
  type ScoreStep,
} from './score.ts';
