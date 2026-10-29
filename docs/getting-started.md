# Getting started

Five minutes from an `.ibt` file to a CSV you can analyse. You need Node 24 or later.

```
git clone https://github.com/estem8/iracing-tire-lab
cd iracing-tire-lab
npm install
```

The tools run TypeScript directly; there is no build step.

## 1. See what a file contains

```
npm run tire-lab -- inspect session.ibt
```

You get the tick rate, the number of records, a session summary without personal fields, and every channel with its unit, array length and the description the sim wrote. Add `--json` for the same as data.

Check here before you rely on a channel: **not every car records every channel**. A channel that is absent from the list is absent from the file, and the lab treats it as unknown, never as zero. What is known about the tire channels is in [channels.md](channels.md).

## 2. Export the channels you want

```
npm run tire-lab -- export session.ibt \
  --channels SessionTime,Speed,LFtempCL,LFtempCM,LFtempCR \
  --stride 3 --out stint.csv
```

`--stride 3` keeps every third record (60 Hz becomes 20 Hz). Name one element of an array channel as `Name[index]`, for example `LatAccel_ST[2]`. Alongside `stint.csv` you get `stint.meta.json` with the units and a session summary, so the CSV is never separated from what its columns mean.

Floats are written as the shortest text that reads back to the exact same value, so exporting does not change a number.

## 3. See what a model would be given

```
npm run tire-lab -- sample session.ibt --out input.csv
```

This writes the input stream of a model run the way the overlay runs its tire processor: 15 Hz, and only the channels the live SDK is known to send (`--mask live`, the default). Use `--mask all` to keep everything in the file. An empty cell means unknown.

Why both settings exist, and what is still unverified about the live set, is in the README section "Judging a model the way the overlay would run it".

## 4. Use it from your own code

The package is not on npm yet, so install it from a tarball (installing from a git tag is not tested yet). It ships compiled JavaScript with type declarations: Node cannot run TypeScript from inside `node_modules`, so the sources are not importable.

```
npm run build && npm pack          # makes iracing-tire-lab-0.0.0.tgz
npm install ../iracing-tire-lab/iracing-tire-lab-0.0.0.tgz   # in your project
```

Entry points (anything else is blocked by the package `exports`):

| Import                     | What                                              | Needs                                       |
| -------------------------- | ------------------------------------------------- | ------------------------------------------- |
| `iracing-tire-lab/ibt`     | read `.ibt` files, anonymize, session summary     | Node (`node:fs`)                            |
| `iracing-tire-lab/model`   | model contract types and the input mask           | nothing: pure, safe in a browser or overlay |
| `iracing-tire-lab/replay`  | IBT to model input, 15 Hz schedule, `replayModel` | Node                                        |
| `iracing-tire-lab/testing` | `buildIbt`, to make synthetic files in your tests | Node                                        |

The `tire-lab` command is installed too (`npx tire-lab inspect file.ibt`). `npm run check:package` installs the tarball into an empty project and verifies all of this.

Two runnable examples, which import from the source files because they live in this repository:

- [`examples/read-channels.ts`](../examples/read-channels.ts): open a file, list channels with units, read a scalar and an array element.
- [`examples/replay-a-model.ts`](../examples/replay-a-model.ts): replay a model at 15 Hz with the live mask. The model in it is a smoothing filter that only shows the API.

Run either with `node examples/<name>.ts`. They build a small synthetic file, so they need no recording. To try your own file, replace the file path they create.

## 5. Share a file safely

An `.ibt` contains your name, user id, iRating and the names of the other drivers in the session. Do not post it. Share the CSV and its `.meta.json` instead, or run `tire-lab anonymize in.ibt out.ibt` and check the result with `inspect`. See [recording-protocol.md](recording-protocol.md).
