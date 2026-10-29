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

export const stimulus = (): StimulusFrame[] => {
  const frames: StimulusFrame[] = [];
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
    const carcass = afterStop ? 62 : 41;
    const frame: StimulusFrame = {
      SessionTime: t,
      SessionNum: t < SESSION_CHANGE_S ? 0 : 1,
      IsOnTrack: true,
      OnPitRoad: pit,
      PitstopActive: stopped,
      PitSvFlags: t >= PIT_IN_S - 10 && t < PIT_OUT_S - 5 ? 0xf : 0,
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
      frame[`${c}tempCL`] = carcass - 2;
      frame[`${c}tempCM`] = carcass;
      frame[`${c}tempCR`] = carcass + 2;
      for (const z of ['L', 'M', 'R']) {
        frame[`${c}wear${z}`] = afterStop ? 0.99 : 0.97;
      }
    }
    frames.push(frame);
    t += i % 2 === 0 ? 0.05 : 0.1;
  }
  return frames;
};
