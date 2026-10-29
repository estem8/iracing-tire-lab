/**
 * A synthetic drive, made of sines, with no recording behind it. It stands in
 * for the 15 Hz ticks the overlay's TireProcessor receives: the step alternates
 * 50 and 100 ms. The same function feeds the real processor (when the golden
 * file is made) and the lab model (when it is checked), so the two see the same
 * numbers.
 *
 * The tire change is ordered ten seconds before the pit lane, as the menu is set
 * on the way in. Phases: drive, a new session (SessionNum 0 to 1, which clears the model), drive,
 * a pit stop with a tire change and a fresh reading, drive again.
 */
export type StimulusFrame = Record<string, number | boolean>;

export const CARS = [
  'ferrari296gt3',
  'bmwm4gt3',
  'cadillacvseriesrgtp',
] as const;
export const SESSION_CHANGE_S = 80;
export const PIT_IN_S = 140;
export const PIT_OUT_S = 170;
export const END_S = 230;

const CORNERS = ['LF', 'RF', 'LR', 'RR'] as const;

/**
 * Variants that reach different branches of the overlay's state machine:
 *  base     tire change ordered before the pit lane, flags cleared on pit road, zones uneven
 *  during   the flags are still set when the reading refreshes
 *  late     the change is ordered only while the service runs
 *  menu     the change is ordered by the pit-menu boxes, left side only
 *  nochange a stop with a fresh reading but no tire change
 *  stale    the first reading is hot (a last session's) on tires that read new
 *  even     the first reading is the same in every zone, like fresh tires
 */
export const VARIANTS = [
  'base',
  'during',
  'late',
  'menu',
  'nochange',
  'stale',
  'even',
] as const;
export type Variant = (typeof VARIANTS)[number];

export const stimulus = (variant: Variant = 'base'): StimulusFrame[] => {
  const frames: StimulusFrame[] = [];
  const start = {
    stale: { carcass: 70, wear: 1, even: false },
    even: { carcass: 36, wear: 1, even: true },
  }[variant as 'stale' | 'even'] ?? { carcass: 41, wear: 0.97, even: false };
  let t = 0;
  for (let i = 0; t <= END_S; i++) {
    const lap = (t % 60) / 60;
    const pit = t >= PIT_IN_S && t < PIT_OUT_S;
    const stopped = t >= PIT_IN_S + 10 && t < PIT_OUT_S - 5;
    const lateral = pit ? 0 : 12 * Math.sin(2 * Math.PI * 3 * lap);
    const longitudinal = pit ? 0 : -9 * Math.sin(2 * Math.PI * 5 * lap);
    const speed = pit
      ? stopped
        ? 0
        : 15
      : 45 + 25 * Math.sin(4 * Math.PI * lap);
    const afterStop = t >= PIT_IN_S + 10;
    const carcass = afterStop ? 62 : start.carcass;
    const frame: StimulusFrame = {
      SessionTime: t,
      SessionNum: t < SESSION_CHANGE_S ? 0 : 1,
      IsOnTrack: true,
      OnPitRoad: pit,
      PitstopActive: stopped,
      PitSvFlags: flags(variant, t),
      Speed: speed,
      VelocityX: speed,
      VelocityY: 0.3 * Math.sin(2 * Math.PI * lap),
      YawRate: pit ? 0 : lateral / Math.max(speed, 10),
      SteeringWheelAngle: lateral / 12,
      SteeringWheelTorque: Math.abs(lateral) * 1.2,
      LatAccel: lateral,
      LongAccel: longitudinal,
      VertAccel: 9.81,
      Throttle: Math.max(0, longitudinal) / 6,
      Brake: Math.max(0, -longitudinal) / 9,
      AirTemp: 22,
      TrackTemp: 32,
      LapCompleted: Math.floor(t / 90),
      LapDistPct: (t % 90) / 90,
    };
    for (const c of CORNERS) {
      // The carcass reading stays frozen until the service starts, as in the sim.
      const spread = !afterStop && start.even ? 0 : 2;
      frame[`${c}tempCL`] = carcass - spread;
      frame[`${c}tempCM`] = carcass;
      frame[`${c}tempCR`] = carcass + spread;
      frame[`${c}coldPressure`] = 165;
      for (const z of ['L', 'M', 'R']) {
        frame[`${c}wear${z}`] = afterStop ? 0.99 : start.wear;
      }
    }
    if (variant === 'menu' && t >= PIT_IN_S - 10 && t < PIT_OUT_S - 5)
      frame.dpLTireChange = 1;
    frames.push(frame);
    t += i % 2 === 0 ? 0.05 : 0.1;
  }
  return frames;
};

/**
 * PitSvFlags: the tire-change bits. The reading refreshes at PIT_IN_S + 10, when
 * the service starts, and the service runs until PIT_OUT_S - 5.
 *  base    set on the way in, cleared on pit road: only the remembered order is left at the reading
 *  during  still set at the reading
 *  late    set only after the reading, while the service runs
 */
const flags = (variant: Variant, t: number): number => {
  const on = (from: number, to: number) => (t >= from && t < to ? 0xf : 0);
  if (variant === 'nochange' || variant === 'menu') return 0;
  if (variant === 'during') return on(PIT_IN_S - 10, PIT_OUT_S - 5);
  if (variant === 'late') return on(PIT_IN_S + 15, PIT_OUT_S - 5);
  return on(PIT_IN_S - 10, PIT_IN_S);
};
