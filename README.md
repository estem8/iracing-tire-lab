# iracing-tire-lab

A research lab for an empirically validated model of iRacing tire state. It reads `.ibt` telemetry, exports chosen channels, and (next) replays them through a pure model and measures the error against what the game reports.

**Status: scaffold.** There is no model yet. What exists is a reader, a CLI and the rules for contributing. The goal is a small model package that the [irdashies](https://github.com/tariknz/irdashies) tire widget can use, not a simulation of iRacing's internal tire physics.

## Use

Needs Node >= 24.

```
npm install
npm run tire-lab -- inspect session.ibt            # channels, units, session summary
npm run tire-lab -- export session.ibt --channels SessionTime,Speed,LFtempCL --out stint.csv --stride 3
npm run tire-lab -- anonymize in.ibt out.ibt       # same-length redaction of names and ids
npm test
```

## Layout

| Path                         | What                                                          |
| ---------------------------- | ------------------------------------------------------------- |
| `src/ibt/`                   | `.ibt` reader: header, var table with units, array channels   |
| `src/cli/`                   | `inspect`, `export`, `anonymize`                              |
| `src/model/`                 | provisional contract; the model will live here, pure          |
| `channels/channels.yaml`     | which channels are verified, with evidence                    |
| `datasets/manifest.json`     | list of recordings (the recordings themselves are not in git) |
| `docs/recording-protocol.md` | how to capture a useful stint                                 |

## Roadmap

1. Reader and export (this scaffold).
2. Establish which tire values the sim gives directly and when they update, from recordings.
3. Deterministic replay and error metrics (MAE, RMSE, max, by wheel, zone and phase).
4. One narrow model, judged on held-out recordings.
5. A small package for irdashies.

See [CONTRIBUTING.md](CONTRIBUTING.md). Licence: MIT; see [NOTICE](NOTICE) for code adapted from irdashies.
