# iracing-tire-lab

A research lab for an empirically validated model of iRacing tire state. It reads `.ibt` telemetry, exports chosen channels, and (next) replays them through a pure model and measures the error against what the game reports.

**Status: scaffold.** There is no model yet. What exists is a reader, a CLI and the rules for contributing. The goal is a small model package that the [irdashies](https://github.com/tariknz/irdashies) tire widget can use, not a simulation of iRacing's internal tire physics.

## Use

Needs Node >= 24. New here? Start with [docs/getting-started.md](docs/getting-started.md); what is known about each channel is in [docs/channels.md](docs/channels.md).

```
npm install
npm run tire-lab -- inspect session.ibt            # channels, units, session summary
npm run tire-lab -- export session.ibt --channels SessionTime,Speed,LFtempCL --out stint.csv --stride 3
npm run tire-lab -- sample session.ibt --out input.csv   # what a model would be given: 15 Hz, live inputs only
npm run tire-lab -- anonymize in.ibt out.ibt       # same-length redaction of names and ids
npm test
```

## Judging a model the way the overlay would run it

A recording can hold more than the overlay receives, and the overlay runs its tire processor at 15 Hz. A model is therefore replayed with two constraints that match production:

- **Live input mask** (`src/model/mask.ts`): `live` hides the channels the live SDK is not known to send (surface temperature, hot pressure); `all` shows everything. Report results with `live`. The live set is provisional: it comes from one live dump, and the reported freezing of carcass and wear readings between pit stops is not modelled yet.
- **15 Hz schedule** (`src/replay/schedule.ts`): the overlay's own rate limiter, with its carried deadline, applied to 60 Hz frames. The first sample has `dt` 0 and later ones the real time between kept frames.

`replayModel` in `src/replay/replay.ts` resets the model, applies both, and yields steps; the same inputs always give the same steps. Check the schedule against irdashies' `ProcessorHost.takeTick` when that changes.

## Layout

| Path                         | What                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `src/ibt/`                   | `.ibt` reader: header, var table with units, array channels   |
| `src/cli/`                   | `inspect`, `export`, `sample`, `anonymize`                    |
| `src/replay/`                | IBT to model input, 15 Hz schedule, deterministic replay      |
| `src/model/`                 | provisional contract and input mask; the model will live here |
| `channels/channels.yaml`     | which channels are verified, with evidence                    |
| `datasets/manifest.json`     | list of recordings (the recordings themselves are not in git) |
| `docs/getting-started.md`    | from an `.ibt` to a CSV; installing the package               |
| `docs/channels.md`           | channel reference, generated from `channels.yaml`             |
| `docs/recording-protocol.md` | how to capture a useful stint                                 |
| `examples/`                  | runnable scripts: read a file, replay a model                 |

## Roadmap

1. Reader and export (this scaffold).
2. Establish which tire values the sim gives directly and when they update, from recordings.
3. Deterministic replay and error metrics (MAE, RMSE, max, by wheel, zone and phase).
4. One narrow model, judged on held-out recordings.
5. A small package for irdashies.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licence: MIT; see [NOTICE](NOTICE) for code adapted from irdashies.
