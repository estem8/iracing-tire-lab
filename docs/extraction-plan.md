# Extraction plan: closing the loop

The goal is a loop that does not exist yet:

```
record a session (.ibt) ──> lab replays the model the way the overlay runs it
        ^                              │
        │                              v
overlay logs its own output     lab measures the error against the references
        │                              │
        │                              v
   overlay uses the new   <──  fix in the lab, bump the version, tag
   model version
```

Today the widget estimates tire state in the overlay, and the lab can read, chart and replay recordings, but **the lab has no tire model**. `tools/tire-viewer` in irdashies is the only thing that runs the real model on an `.ibt`. This plan moves the model into the lab so it can be measured and fixed there, then returns it to the overlay.

Status words below: **read** means seen in the code, **unverified** means not run or not checked against a real recording. Everything here was read in the `feat/tire-widget` branch of irdashies at `d421f67`; no real `.ibt` was available.

## 1. What is where

| File (in irdashies `src/app/`)                             | Lines       | What it does                                                                     | Depends on               | Goes to                        |
| ---------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------- | ------------------------ | ------------------------------ |
| `processors/TireThermalModel.ts`                           | 239         | slow tire temperature: heating, cooling, carcass node, per-stop gain calibration | types only               | lab                            |
| `processors/TireSurfaceModel.ts`                           | 236         | tread surface and bulk nodes, brake discs                                        | types only               | lab                            |
| `processors/tireProfiles.ts`                               | 342         | constants per car, `MODEL_VERSION`                                               | none                     | lab                            |
| `processors/YawGrip.ts`                                    | 113         | steering vs yaw learning, slide and slip angles                                  | none                     | lab                            |
| `processors/tireCalibration.ts`                            | 62          | when saved gains apply (version, age, weight)                                    | `MODEL_VERSION`          | lab (policy)                   |
| `storage/tireCalibration.ts`                               | 80          | saves gains to disk                                                              | `electron`, `fs`         | stays in overlay               |
| `processors/TireSlipEstimator.ts`                          | 169         | ABS, spin, lock, understeer highlights                                           | channel names            | separate; not tire temperature |
| `processors/TireProcessor.ts`                              | ~940        | glue: stints, pit service, fresh tires, pressure, wear, setup parsing, snapshot  | `electron` via `tyreLog` | **split**                      |
| `processors/TireStintStats.ts`, `sdkDump.ts`, `tyreLog.ts` | 318, 57, 70 | temporary diagnostics                                                            | `electron`, `fs`         | removed before merge           |

## 2. What the widget actually shows

The displayed temperature is not a model output. It is `modelled value + per-zone spread from the last pit-stop reading`, scaled by how much the tire has warmed since. Pressure and wear are built the same way, from the model plus the last reading. So the thermal and surface models are only the physics layer. There is a second layer, a state machine that reconciles the model with the sim's readings (`trackStints`, `followService`, fresh-tire detection, `pressureOf`). Both layers have to move, or the lab will not reproduce what the driver sees.

## 3. Findings from reading the code (hypotheses, none run)

1. **The shown value and the calibrated value may be different models.** `carcassOf` returns `real.dash(corner)`, the bulk node of `TireSurfaceModel`, for every car whose profile uses `GT3_THERMAL`, which is every car without its own entry. The per-stop gain learning and the saved calibrations act on `TireThermalModel` only. If so, calibration does not change what is shown for those cars. The Ferrari has `calibrates: false`, so the fitted car is not affected; other GT3 cars might be. Check: replay a non-Ferrari recording with a pit stop and compare the two models.
2. **Step-size comments are stale.** `TireThermalModel` and `TireStintStats` say steps are about 0.07 s at 15 Hz. With frames at about 20 Hz and a 15 Hz tick the step alternates 50 and 100 ms (the lab reproduces this; the 20 Hz comes from a single harness measurement). The surface model also clamps a step to 0.1 s and the thermal model to 0.5 s, so a hitch loses different amounts of time in each.
3. **Channels the code reads that the lab registry has not verified:** `TrackTemp` (marked deprecated in the sim's own description, but used as the fallback and for the track share), `dcBrakeBias` (no unit, described as an "adjustment", but read as a percentage between 20 and 80), `VelocityX`, `VelocityY`, `SteeringWheelTorque`, `PitstopActive`, `LapCompleted`, `LapDistPct`.
4. **One geometry for every car.** `slipAngles` and `slideOf` use one steering ratio and one pair of axle arms; the code marks them `shortcut`.
5. **Coverage is thin.** Only the Ferrari 296 GT3 and the Cadillac are fitted; the truck and Super Formula profiles say they are provisional.
6. **Time in the garage is skipped.** `stepThermal` returns early when `IsOnTrack` is false, so tires neither heat nor cool while the car is out of the world. Whether the sim cools them is unknown.

### A correction to what the lab said earlier

The lab's notes treated the carcass channels (`*tempC*`) in an `.ibt` as a live reference. The comment on `TireSurfaceModel.dash` says that reading **stays frozen between pit stops in the `.ibt` too**. If so, the references for the carcass are only the pit-stop readings and the cockpit dash, not a continuous channel. The tread channels (`*temp{L,M,R}`) are reported live in an `.ibt` according to `tools/tire-viewer`, which is also unverified until a real file is read. `tire-lab chart` includes `*tempCM` by default, which should show the freeze if it is real.

## 4. The input the model needs

The model reads far more than tire channels. From the code: `SessionTime`, `SessionNum`, `IsOnTrack`, `OnPitRoad`, `PitstopActive`, `PitSvFlags`, the `dp*TireChange` boxes, `Speed`, `VelocityX/Y`, `YawRate`, `SteeringWheelAngle`, `SteeringWheelTorque`, `LatAccel`, `LongAccel`, `VertAccel`, `Throttle`, `Brake`, `BrakeABSactive`, `dcBrakeBias`, `AirTemp`, `TrackTemp`, `LapCompleted`, `LapDistPct`, `*tempC*`, `*wear*`, `*coldPressure`, `*pressure`, `*shockDefl`, and the car setup text (camber, toe). The lab's `TireSample` carries only tire channels and speed. It has to grow, and each new field must be in `channels/channels.yaml` with its verification status. A channel the file lacks stays `null`, never 0.

## 4b. Milestone 1 results (run, not just read)

Done on 2026-10-29: the five physics files are in `src/model/irdashies/`, pinned to `d421f679dd546758fab92201810b8d26d0ea7974`, with `npm run vendor` to re-vendor or report drift, and `tests/vendor.test.ts` to catch a hand-edited copy. They compile under the lab's strict settings and `tests/boundary.test.ts` now walks subfolders. The irdashies specs for these files were ported to `node:test` (`tests/irdashies-model.test.ts`). Results:

- Thermal model (8 specs), calibration policy (5) and profiles (3): all pass unchanged.
- **Surface model (9 specs): the original spec cannot pass against the code it sits beside.** Its input omits `slipFront` and `slipRear`, which the model multiplies by, so every stepped temperature is `NaN` (reproduced); it also calls `temp(corner, ambient)` and `resetTread(corner, start, ambient)` with an extra argument that the class does not take, which the irdashies type check would reject. With both slip angles set to 0 and the arguments fixed, six pass and three miss their thresholds: braking heats the front 6.4 C (spec: more than 15), banking adds 1.5 C (more than 2), a spin heats the rear 15.2 C (more than 20; 20.4 C with 6 degrees of slip). The three are kept as `todo` with those numbers. Whether the spec predates the 27 October refit or the thresholds were never met is not known. In irdashies there was no CI run on this branch, so none of this had been noticed.
- **One missing input restarts a tire from the air.** `seed()` refills `NaN` with the ambient on the next step, so a single step with a missing input silently loses the tire's temperature (characterised in a test). The processor filters non-finite values, so this is unlikely in the overlay but not guarded by the model.

## 4c. Milestone 2 results (run)

`tests/golden/processor.json` is the real `TireProcessor` of `d421f67` run over a synthetic drive (`tests/golden/stimulus.ts`: 15 Hz ticks with the 50/100 ms step, a session change, a tire change at a pit stop). `scripts/goldenProcessor.cjs` regenerates it from a checkout at the pinned commit (it refuses any other). `src/model/overlayPhysics.ts` is the lab's version of `TireProcessor.stepThermal`.

- **Before the stop the lab equals the overlay exactly** (tread temperature and brake-disc level, three cars, about 2,500 values each compared as rounded integers). Changing `TRACK_SHARE` in the adapter makes it fail, so the test does discriminate.
- **The physics layer is not enough.** After the tire change the overlay resets the tires to fresh ones; the lab alone keeps heating the old ones and differs by up to 25 C at the stop and 8 C a minute later (`tests/overlay-equivalence.test.ts`, last test). The first seeding of a tire (hottest zone, capped at `staleStart`) is also state-machine logic; the test applies it by hand.
- **Not covered:** the shown value (`temp`, with its zone spread), pressure and wear; the slip estimator (`driveSlip` is 0 in the lab, the stimulus has no wheel spin).
- **Found while reading:** `profileFor` gives every car without its own surface the **Cadillac surface constants** (`realSurface: CADILLAC_SURFACE`). So the GT3 dash value comes from a surface model fitted to a GTP car. Together with finding 1 this means GT3 and GTP already share one tire model in the overlay, apart from the thermal layer.

## 5. Milestones

Each is small and has an acceptance test.

1. **Vendor the physics with provenance.** _Done, see 4b._ Copy the pure files of section 1 into `src/model/`, replace `@irdashies/types` with local types, keep the MIT notice in `NOTICE`, and add a script that reports drift from a pinned irdashies commit. _Accept:_ compiles; `tests/boundary.test.ts` passes (relative imports only); no `electron` or `fs`.
2. **Equivalence with the overlay.** _Done for the physics layer, see 4c._ Run the real `TireProcessor` (bundled with esbuild, as `tire-viewer` does) over a small synthetic stimulus and commit the expected output; the lab model must reproduce it. _Accept:_ equal to within floating-point noise, on a stimulus that includes a pit stop and a session change.
3. **Widen the input contract and the adapter.** Extend `TireSample` and `src/replay/samples.ts` with the channels in section 4. _Accept:_ missing channels give `null` in every test; the live mask still hides what the live SDK does not send.
4. **Measure.** Add error metrics (MAE, RMSE, maximum, by wheel and zone, by phase) and a reference file for values that come from outside the `.ibt`, such as dash readings with their time. _Accept:_ one command prints the table for a recording and a reference file.
5. **Run finding 1.** Replay a non-Ferrari GT3 recording with a pit stop; compare shown vs calibrated. _Accept:_ a written result, either a confirmed discrepancy or a closed hypothesis.
6. **Model series on the chart.** Let `tire-lab chart` plot replay output beside the recorded channels. _Accept:_ the same plot `tire-viewer` gives, with a switch per series. After this and milestone 8, `tools/tire-viewer` can be retired.
7. **Return to the overlay.** Export the model through `iracing-tire-lab/model`; in irdashies make `TireProcessor` a thin adapter (channels in, snapshot out), delete the copies, add a contract test on a fixed synthetic sequence. _Accept:_ the widget's output is unchanged for that sequence; CI is green, including on Windows through a temporary `ci/` branch.
8. **Close the loop in a real session.** With a flag, the overlay logs its output with `SessionTime`; the lab reads that log and the `.ibt` of the same session and prints the milestone-4 table. _Accept:_ the numbers the overlay showed can be compared with the recording.

## 6. When the lab finds a discrepancy

| Where it lives                                               | Where it is fixed                                                |
| ------------------------------------------------------------ | ---------------------------------------------------------------- |
| a wrong channel, unit or meaning (for example `dcBrakeBias`) | the overlay adapter, and the registry in the lab                 |
| model constants or structure                                 | the lab; new `MODEL_VERSION`; the overlay bumps the dependency   |
| the stint and pit-stop state machine                         | wherever it lives after milestone 7                              |
| a label or colour on screen (like the pressure `~`)          | the overlay only                                                 |
| step size or frame rate                                      | both: the replay settings in the lab and the code in the overlay |

Each fix: change in the lab, tag, then an irdashies pull request that raises the version and updates the contract test, with the checks run on a temporary `ci/` branch before the real one. Changing a constant changes `MODEL_VERSION`, and every user's saved gains (`startingGains` ignores another version) are discarded by design, so each model release resets that learning.

**Rule: one source of truth.** While the model is vendored, the lab copy and the irdashies copy must not both be edited; the drift script exists to catch it. After milestone 7 the overlay depends on the lab and has no copy.

## 6b. A claim to check: one model per class, and four kinds of start

A third party told the maintainer (relayed, not verified): the NASCAR Next Gen oval car is a different tire model from GT3 and formula cars, GTP and GT3 share one temperature model, and there are four starting temperatures: fresh change, standing start, rolling start, qualifying start (some cars have no difference between some of them).

What the code says today: one thermal fit (`GT3_THERMAL`) for every car without an entry; the truck and Super Formula are scaled copies of an older fit; one surface fit for everything. Start temperature has two inputs, `freshOffset` (after a tire change, learned from the sim's even reading) and `staleStart` (a new session whose first reading is the last session's). There is no notion of standing, rolling or qualifying start; the session type is not read.

How to check it with data, not opinion: record the start of each kind (garage to grid for a race, a rolling start, a qualifying out-lap, a fresh change in the pits) and read the first minutes of the tread channels and the first dash value. The claim is supported if the starting value differs by kind and is the same across the cars the claim says share a model. Needs recordings from at least a GT3, a GTP and a Next Gen car.

## 7. Open decisions

- Does the reconciliation state machine (section 2) move into the lab, or stay in the overlay behind the model? Moving it is the only way to reproduce what the driver sees; leaving it makes the lab's numbers differ from the widget's.
- Is the slip estimator (`TireSlipEstimator`) in scope? It does not affect temperature.
- Should the overlay depend on a git tag of the lab or on a published package? Installing from a git tag is untested.
- Where do reference values from outside the file (dash readings) live, given recordings cannot be committed?

## 8. What was not read

`TireStintStats.ts` beyond its first 40 lines, and `TireSlipEstimator.ts` beyond its first 60. Neither is part of the temperature model, but the plan above assumes they are not.
