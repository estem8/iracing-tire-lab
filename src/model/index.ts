/** The pure model surface: contract types and the input mask. No I/O, no UI. */
export type {
  CarSample,
  ModelEvent,
  StepExtras,
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
export {
  OverlayModel,
  type Gains,
  type OverlayModelOptions,
  type ShownCorner,
} from './overlayModel.ts';
export { MODEL_VERSION } from './irdashies/tireProfiles.ts';
export {
  calibrationKey,
  isSavable,
  startingGains,
  type TireCalibration,
  type TireCalibrationStore,
} from './irdashies/tireCalibration.ts';
export {
  OverlayPhysics,
  frameOf,
  type ChannelFrame,
} from './overlayPhysics.ts';
export { fromTelemetryFrame, type TelemetryFrame } from './telemetry.ts';
