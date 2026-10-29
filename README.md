# iracing-tire-lab

A research lab for an empirically validated model of iRacing tire state. It reads `.ibt` telemetry, exports chosen channels, and (next) replays them through a pure model and measures the error against what the game reports.

**Status: scaffold.** There is no model yet. What exists is a reader, a CLI and the rules for contributing. The goal is a small model package that the [irdashies](https://github.com/tariknz/irdashies) tire widget can use, not a simulation of iRacing's internal tire physics.

## Use

Needs Node >= 24. New here? Start with [docs/getting-started.md](docs/getting-started.md); what is known about each channel is in [docs/channels.md](docs/channels.md).

```
npm install
npm run tire-lab -- inspect session.ibt            # channels, units, session summary
npm run tire-lab -- export session.ibt --channels SessionTime,Speed,LFtempCL --out stint.csv --stride 3
npm run tire-lab -- sample session.ibt --out input.csv   # what a model would be given: 20 Hz frames, 15 Hz ticks, live inputs only
npm run tire-lab -- anonymize in.ibt out.ibt       # best-effort redaction of names and ids; read the result
npm test
```

`anonymize` is best effort. It blanks the fields it knows (names, user and team ids, iRating, session ids) and has not yet been checked on a real recording. It does not remove the session date, track, car or lap times, which can identify a session. To share data, prefer a CSV from `export`, and read any anonymized file with `inspect <file> --session` before sharing it.

## Judging a model the way the overlay would run it

A recording can hold more than the overlay receives, and the overlay does not give its tire processor every sim record. A model is therefore replayed with three constraints that match production:

- **Live input mask** (`src/model/mask.ts`): `live` hides the channels the live SDK is not known to send (surface temperature, hot pressure); `all` shows everything. Report results with `live`. The live set is provisional: it comes from one live dump, and the reported freezing of carcass and wear readings between pit stops is not modelled yet.
- **Arrival rate** (`arrivalHz`, default 20): the sim writes 60 Hz, but frames reach the processors at about 21 Hz in the app (irdashies' performance harness, `docs/PERFORMANCE_TEST_LOG.md`, measured on a recorded tape). That is one measurement; a live game or another build may differ, so it is an option. Pass `60` to skip this stage.
- **15 Hz tick** (`src/replay/schedule.ts`): the overlay's own rate limiter, with its carried deadline, picks the frames the tire processor runs on. The first sample has `dt` 0 and later ones the real time between kept frames. Because 15 Hz is picked from 20 Hz frames, `dt` alternates 50 and 100 ms (2 to 1), not a steady 67 ms. A model whose constants were fitted at one step may behave differently at another, so test it at the real one.

`replayModel` in `src/replay/replay.ts` resets the model, applies all three, and yields steps (`modelInputs` yields just the samples); the same inputs always give the same steps. Check the schedule against irdashies' `ProcessorHost.takeTick` when that changes.

## Layout

| Path                         | What                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `src/ibt/`                   | `.ibt` reader: header, var table with units, array channels   |
| `src/cli/`                   | `inspect`, `export`, `sample`, `anonymize`                    |
| `src/replay/`                | IBT to model input, overlay frame schedule, replay            |
| `src/model/`                 | provisional contract and input mask; the model will live here |
| `channels/channels.yaml`     | which channels are verified, with evidence                    |
| `datasets/manifest.json`     | list of recordings (the recordings themselves are not in git) |
| `docs/getting-started.md`    | from an `.ibt` to a CSV; installing the package               |
| `docs/channels.md`           | channel reference, generated from `channels.yaml`             |
| `docs/release-checklist.md`  | what to check before opening the repo and before publishing   |
| `docs/recording-protocol.md` | how to capture a useful stint                                 |
| `examples/`                  | runnable scripts: read a file, replay a model                 |

## Roadmap

1. Reader and export (this scaffold).
2. Establish which tire values the sim gives directly and when they update, from recordings.
3. Deterministic replay and error metrics (MAE, RMSE, max, by wheel, zone and phase).
4. One narrow model, judged on held-out recordings.
5. A small package for irdashies.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licence: MIT; see [NOTICE](NOTICE) for code adapted from irdashies.
