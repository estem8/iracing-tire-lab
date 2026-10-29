/**
 * What the overlay's tire estimate is made of, for looking at and for
 * experimenting with: the components (cornering heat, braking heat, cooling and
 * so on), what each one does and how, which telemetry it reads, and the numbers
 * that set it. Any number can be replaced, and a component can be switched off,
 * which sets its heat coefficients to zero.
 *
 * Nothing here is a claim about iRacing's own tires. These are the overlay's
 * fitted constants; a switched-off or changed component shows what the overlay's
 * estimate would do without it, not what the game does.
 */
import {
  SURFACE_DEFAULTS,
  type SurfaceConstants,
} from './surface/TireSurfaceModel.ts';
import {
  profileFor,
  type ThermalParams,
  type TireProfile,
} from './irdashies/tireProfiles.ts';

/** Replacement values by parameter id, e.g. { 'surface.wSlip': 0.03 }. */
export type TuningValues = Readonly<Record<string, number>>;

export interface TuningRequest {
  /** Parameter values to replace. */
  values?: TuningValues;
  /** Components switched off. */
  off?: readonly string[];
}

export interface TuningParam {
  id: string;
  label: string;
  unit: string;
  description: string;
  /** The overlay's value for this car. */
  default: number;
  min: number;
  max: number;
  /** The value when its component is switched off; undefined: the switch leaves it alone. */
  off?: number;
}

export interface TuningComponent {
  id: string;
  /** Which of the overlay's two models it belongs to. */
  model: 'surface' | 'thermal' | 'environment' | 'start';
  title: string;
  /** What it is, in plain words. */
  what: string;
  /** How it is computed. */
  how: string;
  /** The telemetry channels it reads, or derives its inputs from. */
  inputs: string[];
  params: TuningParam[];
  /** Whether it has a switch (some only shape the others). */
  switchable: boolean;
}

export interface TuningDescription {
  car: string | undefined;
  /** Which model gives the number the overlay shows for this car, and why. */
  shownBy: string;
  components: TuningComponent[];
}

type Spec = {
  id: string;
  label: string;
  unit: string;
  description: string;
  /** Read the default from the car's profile or the surface defaults. */
  get: (profile: TireProfile) => number | undefined;
  off?: number;
  max?: number;
};

const surface = (key: keyof SurfaceConstants) => (): number =>
  SURFACE_DEFAULTS[key];
const thermal =
  (read: (t: ThermalParams) => number | undefined) => (p: TireProfile) =>
    read(p.thermal);

const component = (
  c: Omit<TuningComponent, 'params'> & { specs: Spec[] },
  profile: TireProfile,
): TuningComponent | undefined => {
  const params = c.specs.flatMap((s): TuningParam[] => {
    const value = s.get(profile);
    if (value === undefined) return [];
    return [
      {
        id: s.id,
        label: s.label,
        unit: s.unit,
        description: s.description,
        default: value,
        min: 0,
        max: s.max ?? (value > 0 ? value * 4 : 1),
        ...(s.off !== undefined && { off: s.off }),
      },
    ];
  });
  if (params.length === 0) return undefined;
  const { specs: _specs, ...rest } = c;
  void _specs;
  return { ...rest, params };
};

const SLIP_INPUTS = [
  'SteeringWheelAngle',
  'Speed',
  'VelocityX',
  'VelocityY',
  'YawRate',
];

export const describeTuning = (
  carPath: string | undefined,
): TuningDescription => {
  const profile = profileFor(carPath);
  const surfaceShows =
    profile.surface === undefined &&
    profile.thermal === profileFor(undefined).thermal;
  const list: (TuningComponent | undefined)[] = [
    // ------------------------------------------------------------ surface model
    component(
      {
        id: 'load',
        model: 'surface',
        title: 'Load on each tire',
        what: 'How much of the car’s weight each tire carries at this moment. Not heat by itself: every heat term below is scaled by it.',
        how: 'load = VertAccel (averaged over a second) / 9.81 + loadAero × (Speed / 50)² ± loadLateral × LatAccel / 9.81, plus for the tires on the outside of the corner and minus for the inside, kept between 0 and loadMax.',
        inputs: ['VertAccel', 'Speed', 'LatAccel'],
        switchable: false,
        specs: [
          {
            id: 'surface.loadAero',
            label: 'Downforce share',
            unit: 'per (m/s/50)²',
            description:
              'Weight added by downforce at 50 m/s, as a share of the car’s weight, growing with the square of the speed.',
            get: surface('loadAero'),
          },
          {
            id: 'surface.loadLateral',
            label: 'Load transfer',
            unit: 'share per g',
            description:
              'Share of the weight moved to the outside tires by 1 g of lateral acceleration.',
            get: surface('loadLateral'),
          },
          {
            id: 'surface.loadMax',
            label: 'Largest load',
            unit: 'share',
            description: 'The most weight one tire is allowed to carry.',
            get: surface('loadMax'),
            max: 8,
          },
          {
            id: 'surface.verticalSmoothS',
            label: 'Vertical averaging',
            unit: 's',
            description:
              'Window over which VertAccel is averaged, so bumps do not count as banking.',
            get: surface('verticalSmoothS'),
            max: 10,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'cornering',
        model: 'surface',
        title: 'Cornering heat (tread)',
        what: 'The tread heats when the tire slides a little sideways while it carries a lateral force.',
        how: 'heat = wSlip × load^qSlip × (|LatAccel| / 9.81) × Speed × slip angle of the tire’s axle (degrees, capped at 12). The slip angle is worked out, not measured: steering angle / 14 minus the sideways velocity of the axle over the forward velocity.',
        inputs: [
          'LatAccel',
          'Speed',
          ...SLIP_INPUTS.filter((c) => c !== 'Speed'),
        ],
        switchable: true,
        specs: [
          {
            id: 'surface.wSlip',
            label: 'Cornering heat',
            unit: 'C/s per unit',
            description: 'How much tread heat the slip power makes.',
            get: surface('wSlip'),
            off: 0,
          },
          {
            id: 'surface.qSlip',
            label: 'Load exponent',
            unit: '',
            description:
              'Heat grows with the load share to this power; below 1 a lightly loaded tire still makes some.',
            get: surface('qSlip'),
            max: 3,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'braking',
        model: 'surface',
        title: 'Braking heat (tread)',
        what: 'Braking drags the front tires’ tread, and the rears’ too, through the load that moves forward.',
        how: 'heat = wBraking × load^qSlip × Speed × (deceleration / 9.81), deceleration = −LongAccel when braking, capped at 2.5 g, on every tire.',
        inputs: ['LongAccel', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'surface.wBraking',
            label: 'Braking heat',
            unit: 'C/s per unit',
            description: 'Tread heat per speed times deceleration.',
            get: surface('wBraking'),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'traction',
        model: 'surface',
        title: 'Traction heat (rear tread)',
        what: 'Accelerating loads the driven rear tires.',
        how: 'heat = wDrive × load^qSlip × Speed × (acceleration / 9.81), acceleration = LongAccel when positive, rear tires only.',
        inputs: ['LongAccel', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'surface.wDrive',
            label: 'Traction heat',
            unit: 'C/s per unit',
            description: 'Rear tread heat per speed times acceleration.',
            get: surface('wDrive'),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'wheelspin',
        model: 'surface',
        title: 'Wheelspin heat (rear tread)',
        what: 'Rear wheels spinning faster than the car moves.',
        how: 'heat = wSpin × driveSlip, rear tires only. driveSlip = (driven-wheel slip speed − 1.5 m/s) × Throttle, from the overlay’s slip estimator (engine speed and gear against road speed). The lab does not have that estimator, so driveSlip is 0 here and this component does nothing on a recording.',
        inputs: ['RPM', 'Gear', 'Speed', 'Throttle'],
        switchable: true,
        specs: [
          {
            id: 'surface.wSpin',
            label: 'Wheelspin heat',
            unit: 'C/s per m/s',
            description: 'Rear tread heat per m/s of excess slip.',
            get: surface('wSpin'),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'slide',
        model: 'surface',
        title: 'Sliding heat (tread)',
        what: 'An axle sliding sideways beyond ordinary cornering: a spin, a drift.',
        how: 'heat = wSlide × slide of the tire’s axle × Speed. The slide is |sideways velocity ± arm × YawRate| minus 15 % of the forward speed (at least 8 m/s), when positive.',
        inputs: ['VelocityX', 'VelocityY', 'YawRate', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'surface.wSlide',
            label: 'Sliding heat',
            unit: 'C/s per unit',
            description: 'Tread heat per m/s of slide times speed.',
            get: surface('wSlide'),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'bulk-slip',
        model: 'surface',
        title: 'Cornering heat (bulk)',
        what: 'The carcass and the gas inside it also heat from the cornering slip power, much less than the tread.',
        how: 'bulk heat = wbSlip × (the same slip power as the tread).',
        inputs: [
          'LatAccel',
          'Speed',
          'SteeringWheelAngle',
          'VelocityX',
          'VelocityY',
          'YawRate',
        ],
        switchable: true,
        specs: [
          {
            id: 'surface.wbSlip',
            label: 'Bulk cornering heat',
            unit: 'C/s per unit',
            description: 'Bulk heat per unit of slip power.',
            get: surface('wbSlip'),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'bulk-hysteresis',
        model: 'surface',
        title: 'Rolling heat (bulk)',
        what: 'A rolling tire flexes and warms itself: hysteresis, growing with load and speed.',
        how: 'bulk heat = wbLoad × load^qBulk × Speed.',
        inputs: ['Speed', 'VertAccel', 'LatAccel'],
        switchable: true,
        specs: [
          {
            id: 'surface.wbLoad',
            label: 'Rolling heat',
            unit: 'C/s per unit',
            description: 'Bulk heat per load times speed.',
            get: surface('wbLoad'),
            off: 0,
          },
          {
            id: 'surface.qBulk',
            label: 'Load exponent',
            unit: '',
            description:
              'The bulk heat grows with the load share to this power.',
            get: surface('qBulk'),
            max: 3,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'bulk-braking',
        model: 'surface',
        title: 'Braking heat (bulk)',
        what: 'Heat from the brakes soaking into the tire over several seconds.',
        how: 'bulk heat = wbBrakeAvg × (brake pedal averaged over brakeAvgS seconds) × Speed × load.',
        inputs: ['Brake', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'surface.wbBrakeAvg',
            label: 'Brake soak heat',
            unit: 'C/s per unit',
            description: 'Bulk heat per averaged pedal times speed times load.',
            get: surface('wbBrakeAvg'),
            off: 0,
          },
          {
            id: 'surface.brakeAvgS',
            label: 'Pedal averaging',
            unit: 's',
            description: 'Window over which the brake pedal is averaged.',
            get: surface('brakeAvgS'),
            max: 30,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 'cooling',
        model: 'surface',
        title: 'Cooling and heat exchange',
        what: 'The tread cools toward the air faster at speed and passes heat to the bulk, which gives it back more slowly.',
        how: 'tread: dS/dt = heat − (c0 + c1 × Speed) × (S − ambient) − kTreadBulk × (S − B). bulk: dB/dt = kBulkTread × (S − B) + bulk heat. The temperature shown for a GT3 is B.',
        inputs: ['Speed', 'AirTemp', 'TrackTemp'],
        switchable: false,
        specs: [
          {
            id: 'surface.c0',
            label: 'Still-air cooling',
            unit: '1/s',
            description:
              'Tread cooling rate toward the air with the car standing.',
            get: surface('c0'),
          },
          {
            id: 'surface.c1',
            label: 'Airflow cooling',
            unit: '1/s per m/s',
            description: 'Extra cooling rate per m/s of speed.',
            get: surface('c1'),
          },
          {
            id: 'surface.kTreadBulk',
            label: 'Tread to bulk',
            unit: '1/s',
            description: 'Rate at which the tread gives heat to the bulk.',
            get: surface('kTreadBulk'),
          },
          {
            id: 'surface.kBulkTread',
            label: 'Bulk to tread',
            unit: '1/s',
            description: 'Rate at which the bulk gives heat back.',
            get: surface('kBulkTread'),
          },
        ],
      },
      profile,
    ),
    // ------------------------------------------------------------ environment
    component(
      {
        id: 'ambient',
        model: 'environment',
        title: 'Air the tires cool toward',
        what: 'The surface model cools toward the air pulled partly toward the track temperature, because the road is not air.',
        how: 'ambient = AirTemp + share × (TrackTemp − AirTemp). With no TrackTemp the air alone. (The slow thermal model below uses the air alone.)',
        inputs: ['AirTemp', 'TrackTemp'],
        switchable: false,
        specs: [
          {
            id: 'env.trackShare',
            label: 'Track share',
            unit: 'share',
            description:
              'How much of the track-over-air difference the tire cools toward.',
            get: () => TRACK_SHARE_DEFAULT,
            max: 1,
          },
        ],
      },
      profile,
    ),
    // ------------------------------------------------------------ thermal (slow) model
    component(
      {
        id: 't-cornering',
        model: 'thermal',
        title: 'Slow model: cornering heat',
        what: 'The slow model’s heat from cornering, more on the outside tires. It is the number the overlay shows for cars other than a default GT3, and what stop readings calibrate.',
        how: 'heat = heat × Speed × (|LatAccel| × 0.25 × (1 ± loadTransfer)), times rearShare on the rear tires.',
        inputs: ['LatAccel', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'thermal.heat',
            label: 'Cornering heat',
            unit: 'C/s per unit',
            description: 'Heat per speed times lateral load.',
            get: thermal((t) => t.heat),
            off: 0,
          },
          {
            id: 'thermal.rearShare',
            label: 'Rear share',
            unit: 'multiple',
            description: 'Rear cornering heat as a multiple of the front’s.',
            get: thermal((t) => t.rearShare),
            max: 3,
          },
          {
            id: 'thermal.loadTransfer',
            label: 'Load transfer',
            unit: 'share',
            description:
              'Share of the lateral load moved from the inside to the outside tires.',
            get: thermal((t) => t.loadTransfer),
            max: 1,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-braking',
        model: 'thermal',
        title: 'Slow model: braking heat',
        what: 'Heat from braking, split front and rear by the brake bias.',
        how: 'heat = brakeHeat × Speed × deceleration on the front tires, and the same times rearBrake × (1 − bias) / bias on the rear. Bias is dcBrakeBias as a percentage when it lies between 20 and 80, else 50 %.',
        inputs: ['LongAccel', 'Speed', 'dcBrakeBias'],
        switchable: true,
        specs: [
          {
            id: 'thermal.brakeHeat',
            label: 'Braking heat',
            unit: 'C/s per unit',
            description: 'Front heat per speed times deceleration.',
            get: thermal((t) => t.brakeHeat),
            off: 0,
          },
          {
            id: 'thermal.rearBrake',
            label: 'Rear brake multiple',
            unit: 'multiple',
            description:
              'Rear brake heat relative to the front’s per unit of braking force.',
            get: thermal((t) => t.rearBrake),
            max: 3,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-traction',
        model: 'thermal',
        title: 'Slow model: traction heat',
        what: 'Heat on the driven rear tires when accelerating.',
        how: 'heat = accelHeat × Speed × acceleration, rear tires only.',
        inputs: ['LongAccel', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'thermal.accelHeat',
            label: 'Traction heat',
            unit: 'C/s per unit',
            description: 'Rear heat per speed times acceleration.',
            get: thermal((t) => t.accelHeat),
            off: 0,
            max: 0.01,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-aero',
        model: 'thermal',
        title: 'Slow model: aerodynamic load',
        what: 'Heat on every tire that grows steeply with speed, standing for downforce.',
        how: 'heat = aeroHeat × Speed³ / 1000 on every tire.',
        inputs: ['Speed'],
        switchable: true,
        specs: [
          {
            id: 'thermal.aeroHeat',
            label: 'Aero heat',
            unit: 'C/s per (m/s)³×10³',
            description: 'Heat per speed cubed (thousands).',
            get: thermal((t) => t.aeroHeat),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-cold',
        model: 'thermal',
        title: 'Slow model: cold-tire boost',
        what: 'Cold rubber heats faster; the boost fades out as the tire warms.',
        how: 'all heat is multiplied by 1 + coldBoost × clamp((coldBelow − temperature) / 25, 0, 1).',
        inputs: [],
        switchable: true,
        specs: [
          {
            id: 'thermal.coldBoost',
            label: 'Cold boost',
            unit: 'share',
            description: 'Extra heating of a cold tire, as a share.',
            get: thermal((t) => t.coldBoost),
            off: 0,
            max: 2,
          },
          {
            id: 'thermal.coldBelow',
            label: 'Cold below',
            unit: 'C',
            description: 'Temperature at which the boost has faded out.',
            get: thermal((t) => t.coldBelow),
            max: 120,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-spin',
        model: 'thermal',
        title: 'Slow model: wheelspin heat',
        what: 'Rear wheelspin, heating more the hotter the tire already is, up to a cap.',
        how: 'heat = spinHeat × min(temperature − ambient, spinHeatCap) × driveSlip, times spinStill when the car is nearly standing. driveSlip is 0 in the lab (see the wheelspin component above).',
        inputs: ['RPM', 'Gear', 'Throttle', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'thermal.spinHeat',
            label: 'Wheelspin heat',
            unit: 'per C per m/s',
            description: 'Rear heat per degree over ambient and m/s of slip.',
            get: thermal((t) => t.spinHeat),
            off: 0,
          },
          {
            id: 'thermal.spinHeatCap',
            label: 'Spin heat cap',
            unit: 'C',
            description:
              'Degrees over ambient beyond which spin heats no faster.',
            get: thermal((t) => t.spinHeatCap),
            max: 200,
          },
          {
            id: 'thermal.spinStill',
            label: 'Standing share',
            unit: 'share',
            description:
              'Share of the spin heat when held still against a wall.',
            get: thermal((t) => t.spinStill),
            max: 1,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-scrub',
        model: 'thermal',
        title: 'Slow model: scrub heat (front)',
        what: 'The front tires scrubbing when the car does not turn as much as the steering says (understeer).',
        how: 'heat = scrub.heat × unexplained steering × Speed. Unexplained = the steering-implied yaw rate minus the car’s, learned while the front grips.',
        inputs: ['SteeringWheelAngle', 'YawRate', 'Speed', 'LatAccel'],
        switchable: true,
        specs: [
          {
            id: 'thermal.scrub.heat',
            label: 'Scrub heat',
            unit: 'C/s per rad',
            description:
              'Front heat per rad of unexplained steering times speed.',
            get: thermal((t) => t.scrub?.heat),
            off: 0,
          },
          {
            id: 'thermal.scrub.outside',
            label: 'Outside share',
            unit: 'share',
            description:
              'Share of the scrub heat moved from the inside to the outside tire.',
            get: thermal((t) => t.scrub?.outside),
            max: 1,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-bank',
        model: 'thermal',
        title: 'Slow model: banking heat',
        what: 'Extra vertical load on a banked track presses the tires harder than the lateral acceleration says.',
        how: 'heat = bank.heat × max(0, VertAccel (averaged) − 9.81 − bank.from) × Speed.',
        inputs: ['VertAccel', 'Speed'],
        switchable: true,
        specs: [
          {
            id: 'thermal.bank.heat',
            label: 'Banking heat',
            unit: 'C/s per unit',
            description: 'Heat per m/s² beyond the threshold times speed.',
            get: thermal((t) => t.bank?.heat),
            off: 0,
          },
          {
            id: 'thermal.bank.from',
            label: 'Threshold',
            unit: 'm/s²',
            description:
              'Vertical acceleration beyond g that goes unnoticed: bumps, crests.',
            get: thermal((t) => t.bank?.from),
            max: 10,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-slide',
        model: 'thermal',
        title: 'Slow model: sliding heat',
        what: 'An axle sliding sideways: a spin or a drift.',
        how: 'heat = slide × the axle’s slide speed (same input as the surface model’s).',
        inputs: ['VelocityX', 'VelocityY', 'YawRate'],
        switchable: true,
        specs: [
          {
            id: 'thermal.slide',
            label: 'Sliding heat',
            unit: 'C/s per m/s',
            description: 'Heat per m/s of slide.',
            get: thermal((t) => t.slide),
            off: 0,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-cooling',
        model: 'thermal',
        title: 'Slow model: cooling',
        what: 'Cooling toward the air, faster at speed.',
        how: 'cooling rate = cool × (1 + Speed / coolSpeed); the tread loses cooling × (T − AirTemp) per second.',
        inputs: ['Speed', 'AirTemp'],
        switchable: false,
        specs: [
          {
            id: 'thermal.cool',
            label: 'Base cooling',
            unit: '1/s',
            description: 'Cooling rate toward the air.',
            get: thermal((t) => t.cool),
          },
          {
            id: 'thermal.coolSpeed',
            label: 'Airflow speed',
            unit: 'm/s',
            description: 'Speed at which airflow doubles the cooling rate.',
            get: thermal((t) => t.coolSpeed),
            max: 40,
          },
        ],
      },
      profile,
    ),
    component(
      {
        id: 't-carcass',
        model: 'thermal',
        title: 'Slow model: carcass node',
        what: 'A slow second node under the tread, which is what the sim’s stop reading measures. A warm tire standing still holds its temperature through it.',
        how: 'tread loses k × (T − C) to the carcass; the carcass gains kc × (T − C) and loses cool × (C − AirTemp).',
        inputs: ['AirTemp'],
        switchable: false,
        specs: [
          {
            id: 'thermal.carcass.k',
            label: 'Tread to carcass',
            unit: '1/s',
            description: 'Tread heat that flows into the carcass.',
            get: thermal((t) => t.carcass?.k),
          },
          {
            id: 'thermal.carcass.kc',
            label: 'Carcass gain',
            unit: '1/s',
            description: 'Carcass warming per degree the tread is hotter.',
            get: thermal((t) => t.carcass?.kc),
          },
          {
            id: 'thermal.carcass.cool',
            label: 'Carcass cooling',
            unit: '1/s',
            description: 'Carcass cooling toward the air.',
            get: thermal((t) => t.carcass?.cool),
          },
        ],
      },
      profile,
    ),
    // ------------------------------------------------------------ start of a run
    component(
      {
        id: 'start',
        model: 'start',
        title: 'Where tires start',
        what: 'The pit-stop state machine’s start values: a fresh set starts this far over the air, and a new session whose first reading is the last session’s starts at no more than the stale-start value.',
        how: 'fresh = AirTemp + freshOffset (relearned from an even reading); first reading of a session = min(hottest zone, staleStart) when the tires read new.',
        inputs: ['AirTemp', '*tempC (the first reading)', '*wear'],
        switchable: false,
        specs: [
          {
            id: 'start.freshOffset',
            label: 'Fresh offset',
            unit: 'C',
            description: 'Degrees over the air that fresh tires start.',
            get: (p) => p.freshOffset,
            max: 60,
          },
          {
            id: 'start.staleStart',
            label: 'Stale start',
            unit: 'C',
            description:
              'Cap on the start temperature when a new session’s first reading is the last one’s.',
            get: (p) => p.staleStart,
            max: 120,
          },
        ],
      },
      profile,
    ),
  ];
  return {
    car: carPath,
    shownBy: surfaceShows
      ? 'the surface model’s bulk node (a GT3 and any car without its own entry): its cornering, braking, bulk and cooling components decide the number. The slow model still runs and is calibrated at stops, but does not show.'
      : profile.surface !== undefined
        ? 'the slow thermal model (this car’s dash shows the tread, so the surface model gives the tread and the brake disc, not the number). Use the “Slow model” components.'
        : 'the slow thermal model. Use the “Slow model” components.',
    components: list.filter((c): c is TuningComponent => c !== undefined),
  };
};

/** Copied from the processor, which holds it: share of track-over-air the surface model cools toward. */
export const TRACK_SHARE_DEFAULT = 0.3;

/** What a request amounts to: the values to run with, switch-offs included. */
export const resolveTuning = (
  carPath: string | undefined,
  request: TuningRequest,
): TuningValues => {
  const description = describeTuning(carPath);
  const known = new Map(
    description.components.flatMap((c) =>
      c.params.map((p) => [p.id, p] as const),
    ),
  );
  const out: Record<string, number> = {};
  for (const [id, value] of Object.entries(request.values ?? {})) {
    if (!known.has(id)) throw new Error(`Unknown parameter: ${id}`);
    if (!Number.isFinite(value)) throw new Error(`${id} must be a number`);
    const param = known.get(id)!;
    if (value < param.min || value > param.max)
      throw new Error(`${id} must be between ${param.min} and ${param.max}`);
    out[id] = value;
  }
  for (const id of request.off ?? []) {
    const c = description.components.find((x) => x.id === id);
    if (!c) throw new Error(`Unknown component: ${id}`);
    if (!c.switchable) throw new Error(`${id} cannot be switched off`);
    for (const p of c.params) if (p.off !== undefined) out[p.id] = p.off;
  }
  return out;
};

/** The profile, surface constants and track share a set of values describes. */
export const applyTuning = (
  profile: TireProfile,
  values: TuningValues,
): {
  profile: TireProfile;
  surface: Partial<SurfaceConstants>;
  trackShare: number;
} => {
  const surface: Record<string, number> = {};
  const t: ThermalParams = {
    ...profile.thermal,
    ...(profile.thermal.scrub && { scrub: { ...profile.thermal.scrub } }),
    ...(profile.thermal.bank && { bank: { ...profile.thermal.bank } }),
    ...(profile.thermal.carcass && { carcass: { ...profile.thermal.carcass } }),
  };
  const next: TireProfile = { ...profile, thermal: t };
  let trackShare = TRACK_SHARE_DEFAULT;
  for (const [id, value] of Object.entries(values)) {
    const [model, ...path] = id.split('.');
    if (model === 'surface') surface[path[0]] = value;
    else if (model === 'env') trackShare = value;
    else if (model === 'start')
      (next as unknown as Record<string, number>)[path[0]] = value;
    else if (model === 'thermal') {
      const [a, b] = path;
      if (b === undefined) (t as unknown as Record<string, number>)[a] = value;
      else {
        const nested = (
          t as unknown as Record<string, Record<string, number> | undefined>
        )[a];
        if (nested) nested[b] = value;
      }
    }
  }
  return {
    profile: next,
    surface: surface as Partial<SurfaceConstants>,
    trackShare,
  };
};
