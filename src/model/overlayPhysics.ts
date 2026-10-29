import { GT3_THERMAL, profileFor } from './irdashies/tireProfiles.ts';
import type { TireProfile } from './irdashies/tireProfiles.ts';
import { TireSurfaceModel } from './irdashies/TireSurfaceModel.ts';
import { TireThermalModel } from './irdashies/TireThermalModel.ts';
import { slideOf, slipAngles } from './irdashies/YawGrip.ts';
import { carChannels } from './channels.ts';
import type { Corner, StepExtras, TireSample } from './types.ts';

/** Copied from TireProcessor.ts, which is not vendored (it is the glue, see docs/extraction-plan.md). */
export const DEFAULT_AMBIENT = 25;
const TRACK_SHARE = 0.3;

/** One frame by SDK channel name; a channel that is absent is absent, never 0. */
export type ChannelFrame = Readonly<
  Record<string, number | boolean | undefined>
>;

const num = (frame: ChannelFrame, key: string): number | undefined => {
  const v = frame[key];
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
};

/**
 * The physics layer of the overlay's TireProcessor, and nothing above it: the
 * same models, fed the same way as `TireProcessor.stepThermal`. It leaves out
 * the stint and pit-stop state machine (a stop does not reset or calibrate a
 * tire here) and the slip estimator (wheel-spin heat, `driveSlip`, is 0 unless the caller gives it). So it
 * reproduces the processor only between session changes and stops, and on a
 * stimulus without wheel spin; tests/overlay-equivalence.test.ts says so with a
 * real processor's output.
 */
export class OverlayPhysics {
  readonly profile: TireProfile;
  readonly thermal = new TireThermalModel();
  readonly surface: TireSurfaceModel;
  private lastTime: number | undefined;

  constructor(carPath: string | undefined) {
    this.profile = profileFor(carPath);
    this.thermal.configure(this.profile.thermal);
    this.surface = new TireSurfaceModel(
      (this.profile.surface ?? this.profile.realSurface)!,
    );
  }

  /** Whether this car's own dash shows the surface model, as in the processor. */
  get dashShowsSurface(): boolean {
    return this.profile.surface !== undefined;
  }

  /** Starts again, as the processor does on a new session. */
  reset(): void {
    this.thermal.reset();
    this.surface.reset();
    this.lastTime = undefined;
  }

  /**
   * Puts a tire at a temperature, as the processor does when it seeds a tire
   * from a reading or fits a fresh one. The rule that picks the value is in
   * the state machine, which the lab does not have yet.
   */
  start(corner: Corner, value: number): void {
    this.thermal.set(corner, value);
    this.surface.resetTread(corner, value);
  }

  /** The temperature the overlay builds its shown value on (before the per-zone spread). */
  carcass(corner: Corner): number | undefined {
    if (
      this.surface.active &&
      !this.dashShowsSurface &&
      this.profile.thermal === GT3_THERMAL
    )
      return this.surface.dash(corner);
    return this.thermal.mean(corner);
  }

  step(frame: ChannelFrame, extras: StepExtras = {}): void {
    const time = num(frame, 'SessionTime');
    const dt =
      time !== undefined && this.lastTime !== undefined
        ? time - this.lastTime
        : 0;
    this.lastTime = time;
    if (frame.IsOnTrack !== true) return;

    const air =
      num(frame, 'AirTemp') ?? num(frame, 'TrackTemp') ?? DEFAULT_AMBIENT;
    const track = num(frame, 'TrackTemp');
    const speed = num(frame, 'Speed') ?? 0;
    const forward = num(frame, 'VelocityX') ?? speed;
    const sideways = num(frame, 'VelocityY') ?? 0;
    const yaw = num(frame, 'YawRate') ?? 0;
    const wheel = num(frame, 'SteeringWheelAngle') ?? 0;
    const slide = slideOf(forward, sideways, yaw);
    const slip = slipAngles(wheel, speed, forward, sideways, yaw);
    const bias = num(frame, 'dcBrakeBias');
    const input = {
      dt,
      speed,
      lateral: num(frame, 'LatAccel') ?? 0,
      longitudinal: num(frame, 'LongAccel') ?? 0,
      driveSlip: extras.driveSlip ?? 0,
      ambient: air,
      steering: Math.abs(wheel),
      yawRate: Math.abs(yaw),
      torque: Math.abs(num(frame, 'SteeringWheelTorque') ?? 0),
      throttle: num(frame, 'Throttle') ?? 0,
      vertical: num(frame, 'VertAccel'),
      brake: num(frame, 'Brake') ?? 0,
      slideFront: slide.front,
      slideRear: slide.rear,
      slipFront: slip.front,
      slipRear: slip.rear,
    };
    this.thermal.step({
      ...input,
      brakeBias:
        bias !== undefined && bias > 20 && bias < 80 ? bias / 100 : 0.5,
    });
    this.surface.step({
      ...input,
      ambient: track === undefined ? air : air + TRACK_SHARE * (track - air),
    });
  }

  /** The tread surface temperature the overlay rounds into `tempReal`. */
  tread(corner: Corner): number {
    return this.surface.temp(corner);
  }
}

/**
 * A model input sample as the channel frame the physics reads. A null field is
 * left out, so the physics falls back exactly as the overlay does for a channel
 * the sim did not send.
 */
export const frameOf = (sample: TireSample): ChannelFrame => ({
  ...carChannels(sample.car),
  SessionTime: sample.t,
  ...(sample.speed !== null && { Speed: sample.speed }),
});
