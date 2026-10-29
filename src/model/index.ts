/** The pure model surface: contract types and the input mask. No I/O, no UI. */
export type {
  CarSample,
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
export {
  EMPTY_CAR,
  readCar,
  carChannels,
  type ChannelGetter,
} from './channels.ts';
