/**
 * Vendored from irdashies (MIT, see NOTICE): src/app/processors/tireProfiles.ts
 * at d421f679dd546758fab92201810b8d26d0ea7974. Do not edit here; see scripts/vendorIrdashies.ts.
 */
/**
 * How a car's tires heat and cool, and where fresh ones start. Everything the
 * thermal model needs to know about a class of car lives here, so a new class
 * is one entry in PROFILES rather than a change to the model.
 */
export interface ThermalParams {
  /** Heat per unit of speed times lateral load, degrees per second. */
  heat: number;
  /** Base cooling rate toward ambient, per second. */
  cool: number;
  /** Speed (m/s) at which airflow doubles the cooling rate. */
  coolSpeed: number;
  /** Share of the cornering heat the rear tires get compared with the fronts. */
  rearShare: number;
  /** Share of the lateral load moved from the inside to the outside tires. */
  loadTransfer: number;
  /** Heat on the front tires per unit of speed times braking deceleration. */
  brakeHeat: number;
  /** Rear brake heat as a multiple of the front's per unit of braking force; 1 is the same tire law, 0 none. */
  rearBrake?: number;
  /** Heat on the driven rear tires per unit of speed times acceleration. */
  accelHeat: number;
  /** Heat on every tire per unit of speed cubed (thousands): aerodynamic load. */
  aeroHeat: number;
  /** Extra heating of cold tires, as a share, fading out at `coldBelow` C. */
  coldBoost: number;
  coldBelow: number;
  /**
   * Heat per unit of driven-wheel slip (m/s beyond ordinary traction, times
   * throttle) and per degree the tire is over ambient.
   */
  spinHeat: number;
  /** Degrees over ambient beyond which wheelspin heats no faster. */
  spinHeatCap: number;
  /** Share of the spin heat when the car is held still against a wall. */
  spinStill: number;
  /**
   * Heat of the front tires from steering the car does not turn on (scrub),
   * found the Grip-O-Meter way: the yaw rate the steering angle should give,
   * learned while the front grips, against the yaw rate the car has. It heats
   * the same temperature as the rest, which cools by the same law.
   */
  scrub?: ScrubParams;
  /** Heat from the extra vertical load of banking; none on a flat track. */
  bank?: BankParams;
  /** Heat per second per m/s of sideways axle slide beyond cornering: a spin or a drift. */
  slide?: number;
  /**
   * A slow second node under the tread, which is what the sim's stop reading
   * measures. The dash shows the tread; it leans on the carcass, so a warm
   * tire sitting still holds its temperature instead of cooling to the air.
   */
  carcass?: CarcassParams;
}

export interface CarcassParams {
  /** Per second, tread heat that flows into the carcass (per degree of difference). */
  k: number;
  /** Per second, carcass warming per degree the tread is hotter. */
  kc: number;
  /** Per second, carcass cooling toward the air. */
  cool: number;
}

export interface BankParams {
  /** Vertical acceleration (m/s2) beyond g that goes unnoticed: bumps, crests. */
  from: number;
  /** Degrees per second per m/s2 beyond that, times speed. */
  heat: number;
}

export interface ScrubParams {
  /** Degrees per second per rad of unexplained steering times speed. */
  heat: number;
  /** Share of the heat moved from the inside to the outside tire. */
  outside: number;
}

/**
 * Names the set of constants below. Saved calibrations were learned against
 * this model, so change it whenever the numbers change.
 */
export const MODEL_VERSION = '2026-10-27-v50';

/**
 * The surface-temperature model for cars whose dash shows the tread surface,
 * which jumps and falls within seconds. See TireSurfaceModel.
 */
export interface SurfaceParams {
  /** Resting surface temperature over the air, front and rear. */
  frontRest: number;
  rearRest: number;
  /** Front heat from steering the car does not turn on times speed (scrub), and from cornering load. */
  frontScrub: number;
  /** Heat per second per m/s of sideways axle slide beyond cornering: a spin, a drift. */
  frontSlide: number;
  rearSlide: number;
  frontCornering: number;
  /** Share of the cornering heat moved to the outside tires. */
  loadTransfer: number;
  /** Rear heat from wheelspin. */
  rearSpin: number;
  /** Braking heat into the disc, front and rear, per unit of speed times decel. */
  frontBrake: number;
  /** Extra front disc heat per pedal squared times speed: hard pedal heats more than deceleration says. */
  frontPedal: number;
  rearBrake: number;
  /**
   * The disc heat has a fast part, which reaches the tire within a second or
   * two (the dash jumps right after hard braking), and a slow part, which
   * keeps feeding it for tens of seconds after the car stops. This share of
   * the braking heat goes to the fast part, the rest to the slow one.
   */
  fastShare: number;
  /** Cooling of each part: base rate and extra per m/s of airflow. */
  fastCool: number;
  fastCoolSpeed: number;
  slowCool: number;
  slowCoolSpeed: number;
  /** How much of each part reaches the tire surface, per second. */
  fastToTire: number;
  slowToTire: number;
  /** Slow disc heat, in the model's own units, drawn as fully hot. */
  discFull: number;
  /** Surface decay: time constant in seconds and extra rate per m/s, front and rear. */
  frontTau: number;
  frontCoolSpeed: number;
  rearTau: number;
  rearCoolSpeed: number;
  /** Surface and carcass exchange heat: coupling, carcass gain and carcass cooling per second. */
  carcassCouple?: number;
  carcassGain?: number;
  carcassCool?: number;
  /** Heat per second per m/s and per m/s2 of vertical load above `bankFrom` (banking). */
  bankHeat?: number;
  bankFrom?: number;
  /** Heat per second per m/s of speed above `rollFrom`: rolling and aero. */
  rollHeat?: number;
  rollFrom?: number;
  /** When set, a wheel's cornering share is its measured load to this power, else the loadTransfer split. */
  loadExp?: number;
  /** Rear heat from cornering load. */
  rearCornering?: number;
  /** Heat from braking while cornering. */
  combinedHeat?: number;
  /** Share of the heat that shows at once and fades in `flashTau` seconds, and that time. */
  flashShare?: number;
  flashTau?: number;
}

export interface TireProfile {
  thermal: ThermalParams;
  /**
   * Degrees over ambient that fresh tires start before the sim has reported
   * any; learned from the sim's even first reading when there is one.
   */
  freshOffset: number;
  /** Start temperature when a new session's first reading is still the last one's. */
  staleStart: number;
  /**
   * Set when the dash shows the tread surface rather than the tire: the shown
   * temperatures then come from the surface model.
   */
  surface?: SurfaceParams;
  /**
   * Whether the heat gains are corrected at each stop from the sim's reading.
   * Off for a car whose constants were fitted to the dash: the sim's reading
   * of the removed tires runs below the dash after a long stint (73.7 against
   * about 80 on the Ferrari), so correcting to it pulls the model off the dash.
   */
  calibrates?: boolean;
  /**
   * The GTP-style surface model run beside the thermal model, for the widget's
   * "real" temperature mode on cars whose dash shows the slow value. Taken
   * from the Cadillac and not fitted to the car.
   */
  realSurface?: SurfaceParams;
}

/**
 * The earlier GT3 fit, kept as the base the truck and Super Formula profiles were scaled from.
 * Fitted second by second against cockpit-dash readings of the hottest zone of
 * each tire: about 500 readings over a Ferrari 296 GT3 at the Nordschleife,
 * Mugello and a skidpad, 2.8 C RMS, including a 20-minute stint and cool-down. Wheelspin: four wall burnouts, 1.5 C RMS.
 */
const LEGACY_THERMAL: ThermalParams = {
  heat: 0.001924,
  cool: 0.0013,
  coolSpeed: 13,
  rearShare: 0.692,
  loadTransfer: 0.64,
  brakeHeat: 0.000662,
  accelHeat: 0.000974,
  aeroHeat: 0.001054,
  coldBoost: 0.178,
  coldBelow: 60,
  spinHeat: 0.0022,
  spinHeatCap: 66,
  spinStill: 0.27,
};

/**
 * One law for all four tires and every car: the same cornering heat on both
 * axles (outside tires more), braking heat on both axles in the ratio of the
 * brake bias, aero, scrub and banking; no per-axle or per-car factor. Fitted
 * to the Ferrari 296 GT3 and Cadillac V-Series.R together, against the pit-stop
 * readings, the gas temperature implied by the live hot pressure in the .ibt
 * recordings (nine first stints) and the Ferrari skidpad dash (4.9 C RMS), with
 * the warm tire on a grid held at 43 C for a minute. The held-out runs fit as
 * well as the earlier per-axle form. shortcut: wheelspin, scrub, banking and
 * slide heat are not part of this fit.
 */
export const GT3_THERMAL: ThermalParams = {
  heat: 0.00286,
  cool: 0.000552,
  coolSpeed: 4.33,
  rearShare: 1,
  loadTransfer: 0.536,
  brakeHeat: 0.00258,
  rearBrake: 1,
  accelHeat: 0,
  aeroHeat: 0.000192,
  coldBoost: 0,
  coldBelow: 60,
  spinHeat: 0.0022,
  spinHeatCap: 66,
  spinStill: 0.27,
  scrub: { heat: 0.00395, outside: 0 },
  // Daytona oval at 77-90 m/s, sustained 13-18 m/s2 vertical: the model was 40 C
  // low on every tire; this and a smaller aero term bring it to 8 C and leave the
  // other runs where they were. shortcut: one oval run, recheck on another.
  bank: { from: 3, heat: 0.00567 },
  // Scaled from the surface model's slide heat by the ratio of the two cornering
  // heats (0.18); no GT3 run has a spin to fit it to. shortcut: unverified.
  slide: 0.06,
  // Race start at Nordschleife: the dash held 43-44 C for the minute on the grid
  // and the first minute rolling while one node cooled 5 C; with a carcass under
  // the tread the first minutes fit to 0.5 / 2.2 C (from 1.1 / 3.7).
  carcass: { k: 0.000587, kc: 0.0249, cool: 0.0103 },
};

/** Scales every source of heat, keeping the cooling. */
const heatScaled = (base: ThermalParams, scale: number): ThermalParams => ({
  ...base,
  heat: base.heat * scale,
  brakeHeat: base.brakeHeat * scale,
  accelHeat: base.accelHeat * scale,
  aeroHeat: base.aeroHeat * scale,
  spinHeat: base.spinHeat * scale,
});

export const DEFAULT_PROFILE: TireProfile = {
  thermal: GT3_THERMAL,
  // The dash read 34 C on leaving the pits with 21 C air, a GT3 35 C with 18.6.
  freshOffset: 16,
  // A new session started from the previous one's reading: 43 C at 18.6 C air,
  // 44 C at 23.5 C air. shortcut: two sessions of one car, recheck elsewhere.
  staleStart: 44,
};

/**
 * Cadillac V-Series.R: fitted to its dash over a skidpad run, a Monza run, a
 * Talladega stop-and-go run and a burnout test (about 1,900 readings): 14 C RMS, median 6 to 9 C. A front tire
 * the dash shows above 90 C is found by a model line at 78 C with precision and
 * recall near 0.7 on both the skidpad and Monza. Good for a warning, not for the number.
 */
const CADILLAC_SURFACE: SurfaceParams = {
  frontRest: 0,
  rearRest: 0,
  frontScrub: 0.2026,
  frontSlide: 1.645,
  rearSlide: 2.159,
  frontCornering: 0.004148,
  loadTransfer: 0.2089,
  rearSpin: 0.488,
  frontBrake: 0.02013,
  frontPedal: 0.06244,
  rearBrake: 0.0221,
  fastShare: 0.439,
  fastCool: 0.04491,
  fastCoolSpeed: 0.00004438,
  slowCool: 0.0003094,
  slowCoolSpeed: 0.01663,
  fastToTire: 0.1022,
  slowToTire: 0.08448,
  discFull: 25,
  frontTau: 76.73,
  frontCoolSpeed: 0.0049,
  rearTau: 77.67,
  rearCoolSpeed: 0.00478,
  carcassCouple: 0.1043,
  carcassGain: 0.00756,
  carcassCool: 0.000009679,
  bankHeat: 0.001845,
  bankFrom: 0.5089,
  rollHeat: 0.1016,
  loadExp: 1,
  rearCornering: 0.0008039,
  rollFrom: 1.002,
  combinedHeat: 0.00104,
  flashShare: 0.09267,
  flashTau: 1.158,
};

/**
 * Per car, by the sim's car path. Only what differs from the default is
 * listed. A car without an entry runs on the GT3 fit and learns its own heat
 * gain at each stop.
 */
const PROFILES: Readonly<Record<string, Partial<TireProfile>>> = {
  ferrari296gt3: { calibrates: false },
  cadillacvseriesrgtp: { surface: CADILLAC_SURFACE },
  // A NASCAR truck at Talladega, provisional: one 35-minute race with two
  // stops, no dash to read. The GT3 fit was 25 to 45 C low at the stop (74 to 90
  // C modelled against 98 to 125 C measured); a bit more heat, even load
  // between the sides (the left tires were as hot as the right) and more on
  // the rears brings the error from 26 C to 17 C. Not enough to say more.
  'trucks ram2026': {
    thermal: {
      ...heatScaled(LEGACY_THERMAL, 1.2),
      loadTransfer: 0,
      rearShare: 1.3,
    },
  },
  // No dash to fit against. Fresh tires start at 52 C with 18.8 C air, and the
  // GT3 fit overheated these tires by about 15 percent at the first stop
  // (gains 0.79 to 0.92), so the heat is scaled to match. Not dash-fitted.
  superformulasf23: {
    thermal: heatScaled(LEGACY_THERMAL, 0.85),
    freshOffset: 33,
  },
};

export const profileFor = (carPath: string | undefined): TireProfile => {
  const profile = {
    ...DEFAULT_PROFILE,
    ...(carPath ? PROFILES[carPath] : undefined),
  };
  return profile.surface
    ? profile
    : { ...profile, realSurface: CADILLAC_SURFACE };
};
