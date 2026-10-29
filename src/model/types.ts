/**
 * PROVISIONAL model contract. Not confirmed against SDK channel semantics:
 * see channels/channels.yaml for what has actually been verified, and do not
 * build on a field whose channel is still `unverified`.
 *
 * This directory must stay pure: no node:*, electron, react, or imports from
 * ../ibt or ../cli (enforced by tests/boundary.test.ts).
 */

export type Corner = 'lf' | 'rf' | 'lr' | 'rr';
export type Zones = readonly [left: number, middle: number, right: number];

/** A value the sim reported, or null when it did not. Never 0 for "unknown". */
export type Measured<T> = T | null;

export interface WheelSample {
  /** Carcass temperature, deg C. Not the surface temperature. */
  carcass: Measured<Zones>;
  /** Tread surface temperature, deg C. Unverified for live telemetry. */
  surface: Measured<Zones>;
  /** Tread remaining, fraction 0..1 (the sim labels the unit '%'). */
  treadRemaining: Measured<Zones>;
  /** Cold pressure as set in the garage, kPa. */
  coldPressureKpa: Measured<number>;
  /** Hot pressure, kPa. Unverified channel. */
  hotPressureKpa: Measured<number>;
}

export interface TireSample {
  /** Session time, s. */
  t: number;
  /** Seconds since the previous sample; the caller decides what a gap is. */
  dt: number;
  speed: Measured<number>;
  wheels: Record<Corner, WheelSample>;
}

/** A model output is always labelled as an estimate. */
export interface Estimate<T> {
  readonly kind: 'estimate';
  readonly model: string;
  readonly value: T;
}

export interface TireOutput {
  carcass: Partial<Record<Corner, Estimate<number>>>;
}

export interface TireModel {
  /** Back to the initial state; identical inputs afterwards give identical outputs. */
  reset(): void;
  /** One explicit time step. A sample with dt outside (0, maxDt] holds state. */
  step(sample: TireSample): TireOutput;
}
