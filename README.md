# iracing-tire-lab

A lab for looking at, testing and improving the tire-state estimate of the [irdashies](https://github.com/tariknz/irdashies) tires widget. It reads iRacing `.ibt` telemetry, runs the widget's model on it exactly as the overlay would, draws the tires, compares laps, lets you switch the model's parts off and change its numbers, and measures the error against reference values.

It is **not** a simulation of iRacing's tire physics, and nothing here says what the game does inside. The model is the overlay's own empirical estimate.

## Status: early, never run on a real recording

- **What is checked:** the code and the model against the real overlay processor on synthetic drives (every frame of 18 runs), the reader and the pages on synthetic `.ibt` files, a Windows build of the program on a Windows runner.
- **What is not:** no real `.ibt` has been read by this project. The channel names, units and meanings are in [docs/channels.md](docs/channels.md) with their status, and most are `unverified`. The accuracy of the model against the game's own readings has not been measured. The pages have been driven in a simulated browser, not looked at in a real one. The iRacing recording switch has not been tried against a running iRacing.
- If something does not match what you see in the game, please [open an issue](../../issues/new/choose).

## What it does

|               |                                                                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Read**      | `.ibt` files: channels, units, session summary without personal fields, export to CSV                                                                                 |
| **Chart**     | any channels, one chart per unit, a switch per series, zoom, hover, table view                                                                                        |
| **Model**     | the overlay's tire estimate beside the recording, with the tires drawn as the widget draws them                                                                       |
| **Laps**      | split by lap, charted by distance, two laps compared with the time difference                                                                                         |
| **Workbench** | the model's 23 components with what they do and which channels they read; switch them off, change their numbers, see the estimate respond; pick the channels to chart |
| **Measure**   | error (MAE, RMSE, largest, bias) against reference values such as dash readings                                                                                       |
| **Program**   | `tire-lab.exe` for Windows: open a file, a switch that tells iRacing to start or stop its telemetry recording                                                         |

## Use it

**On Windows, without installing anything:** take `tire-lab.exe` from the _Windows executable_ workflow's artifacts (Actions tab) and double-click it, or drop an `.ibt` file on it. See [docs/exe.md](docs/exe.md). It is not signed, so Windows will warn about an unknown publisher.

**From source** (Node 24 or later; no build step):

```
git clone https://github.com/estem8/iracing-tire-lab
cd iracing-tire-lab
npm install
npm run tire-lab -- app                            # the local page: open files, laps, tires, workbench
npm run tire-lab -- inspect session.ibt            # channels, units, session summary
npm run tire-lab -- chart session.ibt --out chart.html --model   # recording plus the model, tires panel
npm run tire-lab -- laps session.ibt               # laps and lap times
npm run tire-lab -- lapchart session.ibt --lap 5 --compare 7     # two laps by distance
npm run tire-lab -- score session.ibt --reference ref.json       # error against dash readings
npm run tire-lab -- export session.ibt --channels SessionTime,Speed,LFtempCL --out stint.csv --stride 3
npm run tire-lab -- sample session.ibt --out input.csv           # what a model would be given
npm run tire-lab -- anonymize in.ibt out.ibt       # best-effort redaction; read the result
npm test
```

New here? [docs/getting-started.md](docs/getting-started.md) goes step by step. The workbench is explained in [docs/workbench.md](docs/workbench.md).

`anonymize` is best effort. It blanks the fields it knows (names, user and team ids, iRating, session ids) and has not been checked on a real recording. It does not remove the session date, track, car or lap times, which can identify a session. To share data, prefer a CSV from `export`, and read any anonymized file with `inspect <file> --session` before sharing it. Never commit a recording; `.gitignore` and CI refuse them.

## Judging a model the way the overlay would run it

A recording can hold more than the overlay receives, and the overlay does not give its tire processor every sim record. A model is therefore replayed with three constraints that match production:

- **Live input mask** (`src/model/mask.ts`): `live` hides the channels the live SDK is not known to send (surface temperature, hot pressure); `all` shows everything. Report results with `live`. The live set is provisional: it comes from one live dump, and the reported freezing of carcass and wear readings between pit stops is not modelled yet.
- **Arrival rate** (`arrivalHz`, default 20): the sim writes 60 Hz, but frames reach the processors at about 21 Hz in the app (irdashies' performance harness, `docs/PERFORMANCE_TEST_LOG.md`, measured on a recorded tape). That is one measurement; a live game or another build may differ, so it is an option. Pass `60` to skip this stage.
- **15 Hz tick** (`src/replay/schedule.ts`): the overlay's own rate limiter, with its carried deadline, picks the frames the tire processor runs on. The first sample has `dt` 0 and later ones the real time between kept frames. Because 15 Hz is picked from 20 Hz frames, `dt` alternates 50 and 100 ms (2 to 1), not a steady 67 ms. A model whose constants were fitted at one step may behave differently at another, so test it at the real one.

`replayModel` in `src/replay/replay.ts` resets the model, applies all three, and yields steps (`modelInputs` yields just the samples); the same inputs always give the same steps. Check the schedule against irdashies' `ProcessorHost.takeTick` when that changes.

## Layout

| Path                     | What                                                                                |
| ------------------------ | ----------------------------------------------------------------------------------- |
| `src/ibt/`               | `.ibt` reader: header, var table with units, array channels                         |
| `src/cli/`               | the command line                                                                    |
| `src/app/`               | the local app: server, pages, file dialog, iRacing recording switch, workbench      |
| `src/chart/`             | HTML charts: channels, model lines, tires panel, laps by distance                   |
| `src/replay/`            | IBT to model input, overlay frame schedule, replay                                  |
| `src/metrics/`           | error statistics and the reference-file format                                      |
| `src/model/`             | the pure model: contract, `OverlayModel`, component registry (`tuning.ts`)          |
| `src/model/irdashies/`   | four files of tire physics copied from irdashies, pinned and drift-checked          |
| `src/model/surface/`     | the surface model, forked from irdashies so its constants can change                |
| `tests/golden/`          | the real overlay processor's output on synthetic drives, which the model must equal |
| `scripts/`               | channel docs, vendoring, golden file, package check, executable build               |
| `channels/channels.yaml` | which channels are verified, with evidence                                          |
| `datasets/manifest.json` | list of recordings (the recordings themselves are not in git)                       |
| `docs/`                  | see below                                                                           |
| `examples/`              | runnable scripts: read a file, replay a model                                       |

| Doc                          | What                                                                   |
| ---------------------------- | ---------------------------------------------------------------------- |
| `docs/getting-started.md`    | from an `.ibt` to charts, laps and a CSV; using the package            |
| `docs/exe.md`                | the Windows program                                                    |
| `docs/workbench.md`          | the model workbench: components, switches, numbers                     |
| `docs/references.md`         | reference values (dash readings) and the `score` error table           |
| `docs/channels.md`           | channel reference, generated from `channels.yaml`                      |
| `docs/extraction-plan.md`    | how the model moved out of the overlay, what was checked, what is left |
| `docs/recording-protocol.md` | how to capture a useful stint                                          |
| `docs/release-checklist.md`  | what to check before publishing                                        |

## Where this is going

1. **Real recordings.** Run it on real files, promote channels to `verified`, find out which channels a car records, and measure the model against dash readings. Nothing else can say how good the model is.
2. Move what is still in the overlay (wear, load, camber and toe, the slip estimator) into the lab, so the overlay becomes a thin adapter. See the extraction plan.
3. If real data shows that cars or start types need their own models, make them.
4. Offer the model to irdashies as a package. That is the overlay maintainer's decision, not this repository's.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licence: MIT; see [NOTICE](NOTICE) for code adapted from irdashies.
