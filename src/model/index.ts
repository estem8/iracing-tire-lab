/** The pure model surface: contract types and the input mask. No I/O, no UI. */
export type {
  Corner,
  Estimate,
  Measured,
  TireModel,
  TireOutput,
  TireSample,
  WheelSample,
  Zones,
} from './types.ts';
export { applyMask, type InputMask } from './mask.ts';
